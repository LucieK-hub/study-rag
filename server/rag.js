import { pipeline } from '@xenova/transformers';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import fs from 'fs';
import { HttpError, withRetry } from './util.js';

const FILE = 'data/index.json';
let store = [];
try {
  if (fs.existsSync(FILE)) store = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch {
  console.warn('Could not read data/index.json (corrupted?). Starting with an empty index.');
}
const save = () => { fs.mkdirSync('data', { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(store)); };

// Local multilingual embeddings (Czech + English). Downloaded once, then cached on disk.
let embedder;
async function embed(text) {
  if (!embedder) {
    try {
      embedder = await withRetry(() => pipeline('feature-extraction', 'Xenova/multilingual-e5-small'), { retries: 2, label: 'Embedding model download' });
    } catch {
      throw new HttpError(503, 'Could not load the embedding model. The first run needs an internet connection to download it.');
    }
  }
  const out = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

// Fixed-size chunks with overlap so a sentence cut at a boundary still appears whole in the next chunk.
export function chunkText(text, size = 800, overlap = 150) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const out = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    out.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return out;
}

export async function addPdf(name, buffer, size, overlap) {
  const pages = [];
  try {
    await pdf(buffer, {
      pagerender: async (p) => {
        const tc = await p.getTextContent();
        const t = tc.items.map((i) => i.str).join(' ');
        pages.push(t);
        return t;
      },
    });
  } catch {
    throw new HttpError(422, 'This file could not be read as a PDF. It may be corrupted or password-protected.');
  }
  const fresh = [];
  for (let p = 0; p < pages.length; p++) {
    for (const text of chunkText(pages[p], size, overlap)) {
      if (text.length < 40) continue;
      fresh.push({ doc: name, page: p + 1, text, vec: await embed('passage: ' + text) });
    }
  }
  if (!fresh.length) throw new HttpError(422, 'No text found in this PDF. Scanned documents need OCR first.');
  // Only replace the old version of the document once the new one was indexed successfully.
  store = [...store.filter((c) => c.doc !== name), ...fresh];
  save();
  return fresh.length;
}

export const listDocs = () => [...new Set(store.map((c) => c.doc))];
export function removeDoc(name) { store = store.filter((c) => c.doc !== name); save(); }

// Vectors are normalized, so the dot product equals cosine similarity.
export async function retrieve(question, k = 4) {
  if (!store.length) throw new HttpError(400, 'No documents indexed yet. Upload a PDF first.');
  const qv = await embed('query: ' + question);
  return store
    .map((c) => ({ doc: c.doc, page: c.page, text: c.text, score: c.vec.reduce((s, v, i) => s + v * qv[i], 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
