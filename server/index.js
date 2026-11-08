import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Groq from 'groq-sdk';
import { addPdf, listDocs, removeDoc, retrieve } from './rag.js';
import { HttpError, withRetry } from './util.js';

const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const K = Number(process.env.TOP_K) || 4;
const MIN = Number(process.env.MIN_SCORE) || 0.8;
const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 20;
const RETRIES = Number(process.env.GROQ_RETRIES ?? 2);

if (!process.env.GROQ_API_KEY) {
  console.warn('WARNING: GROQ_API_KEY is not set. Uploading works, but asking questions will fail. See README.');
}
// maxRetries: 0 because retries are handled by withRetry below (visible in the console).
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || 'missing', maxRetries: 0, timeout: 30000 });

const app = express();
app.use(cors(), express.json());
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_MB * 1024 * 1024 } });
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

async function generate(messages) {
  try {
    const r = await withRetry(
      () => groq.chat.completions.create({ model: MODEL, temperature: 0.1, messages }),
      { retries: RETRIES, label: 'Groq request' },
    );
    const text = r.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('empty response');
    return text;
  } catch (e) {
    if (e.status === 401) throw new HttpError(502, 'Groq rejected the API key. Check GROQ_API_KEY in server/.env.');
    if (e.status === 404 || (e.status === 400 && /model/i.test(e.message))) {
      throw new HttpError(502, `Groq model "${MODEL}" is not available. Choose another GROQ_MODEL (see console.groq.com).`);
    }
    if (e.status === 429) throw new HttpError(503, 'Groq rate limit reached (free tier). Wait a minute and try again.');
    console.error('Groq error:', e.message);
    throw new HttpError(502, 'Could not get an answer from Groq. Please try again.');
  }
}

app.get('/api/docs', (_, res) => res.json(listDocs()));

app.delete('/api/docs/:name', (req, res) => {
  removeDoc(req.params.name);
  res.json(listDocs());
});

app.post('/api/upload', upload.single('file'), wrap(async (req, res) => {
  const f = req.file;
  if (!f) throw new HttpError(400, 'No file received.');
  if (f.mimetype !== 'application/pdf' && !f.originalname.toLowerCase().endsWith('.pdf')) {
    throw new HttpError(415, 'Only PDF files are supported.');
  }
  const name = Buffer.from(f.originalname, 'latin1').toString('utf8'); // keeps Czech characters intact
  const chunks = await addPdf(name, f.buffer);
  console.log(`Indexed ${name}: ${chunks} chunks`);
  res.json({ name, chunks });
}));

app.post('/api/ask', wrap(async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) throw new HttpError(400, 'Question is empty.');
  if (question.length > 1000) throw new HttpError(400, 'Question is too long (max 1000 characters).');

  const all = await retrieve(question, K);
  const hits = all.filter((h) => h.score >= MIN);
  console.log(`Question: "${question}" | top score ${all[0].score.toFixed(3)} | ${hits.length} chunk(s) above ${MIN}`);
  if (!hits.length) return res.json({ answer: "I couldn't find this in your documents.", sources: [] });

  const context = hits.map((h, i) => `[${i + 1}] (${h.doc}, p. ${h.page})\n${h.text}`).join('\n\n');
  const answer = await generate([
    { role: 'system', content: 'Answer only from the numbered context. Cite sources like [1]. If the context does not contain the answer, say you could not find it in the documents. Reply in the language of the question.' },
    { role: 'user', content: `Context:\n${context}\n\nQuestion: ${question}` },
  ]);
  res.json({ answer, sources: hits });
}));

// Central error handler: known errors keep their message, unknown ones are hidden from the user.
app.use((e, req, res, next) => {
  if (res.headersSent) return next(e);
  const status = e.code === 'LIMIT_FILE_SIZE' ? 413 : e.status || 500;
  if (status === 500) console.error(e);
  const message = e.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${MAX_MB} MB.` : status === 500 ? 'Unexpected server error. See the server console.' : e.message;
  res.status(status).json({ error: message });
});

app.listen(3001, () => console.log('API running on http://localhost:3001'));
