# Study Assistant (RAG)

Ask questions about your own PDF notes and get answers with the exact passages and pages they came from.

**Stack:** React + Vite (UI), Node.js + Express (API), local multilingual embeddings (`multilingual-e5-small` via Transformers.js), Groq (answer generation). No Python needed.

## How it works
1. **Index:** each PDF page is split into overlapping ~800-character chunks. Every chunk is turned into a vector on your own machine.
2. **Retrieve:** your question becomes a vector, and the `TOP_K` most similar chunks (cosine similarity) are selected. Chunks scoring below `MIN_SCORE` are discarded.
3. **Generate:** Groq answers using only those chunks and cites them as [1], [2]. If nothing relevant is found, the app says so instead of guessing.

## Setup (Windows)
1. Install [Node.js](https://nodejs.org) 18 or newer. Check with `node -v`.
2. Create a free API key at https://console.groq.com
3. Start the API:
   ```
   cd server
   npm install
   copy .env.example .env
   ```
   Open `server/.env`, paste your key after `GROQ_API_KEY=`, save, then run:
   ```
   npm start
   ```
4. In a second terminal, start the UI:
   ```
   cd client
   npm install
   npm run dev
   ```
5. Open http://localhost:5173

The first upload downloads the embedding model (about 100 MB, once) and needs internet access.

## Environment variables
Set in `server/.env`. Never commit this file (it is in `.gitignore`).

| Variable | Default | Meaning |
|---|---|---|
| `GROQ_API_KEY` | none (required) | Your Groq key. Without it, questions fail with a clear message. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq model used for answers. If it is retired, pick a current one at console.groq.com. |
| `GROQ_RETRIES` | `2` | Extra attempts when Groq fails temporarily (rate limit, timeout, 5xx, network drop). |
| `TOP_K` | `4` | Number of chunks passed to the model. |
| `MIN_SCORE` | `0.8` | Minimum similarity for a chunk to count. Higher = stricter, more "not found" answers. |
| `MAX_UPLOAD_MB` | `20` | Maximum PDF size. |

## Error handling and retries
- **Retries:** Groq calls are retried with exponential backoff (1 s, then 2 s, up to `GROQ_RETRIES` times) on 429, 408, 5xx and network errors, and the `Retry-After` header is respected. Each retry is logged in the server console. The embedding model download is retried the same way. Errors that retrying cannot fix (wrong key, unknown model) fail immediately.
- **Clear messages:** the UI shows what went wrong and what to do (wrong or missing key, unavailable model, rate limit, server not running, file too large, not a PDF, scanned PDF without text, corrupted PDF, empty question, nothing uploaded yet).
- **Safe re-indexing:** uploading a PDF with the same name replaces the old version only after the new one was indexed successfully.

## Example run

1. Start the API. The console shows:
   ```
   API running on http://localhost:3001
   ```
2. In the UI, click **Add a PDF** and choose `statistics-notes.pdf`. The console shows:
   ```
   Indexed statistics-notes.pdf: 142 chunks
   ```
3. Ask: *What is the Central Limit Theorem?*
   ```
   Question: "What is the Central Limit Theorem?" | top score 0.874 | 3 chunk(s) above 0.8
   ```
   The answer appears with citations such as [1], and each source expands to show the highlighted passage and page.
4. Ask something your notes do not cover: *Who won the football World Cup in 2010?*
   ```
   Question: "Who won the football World Cup in 2010?" | top score 0.741 | 0 chunk(s) above 0.8
   ```
   The app answers: *I couldn't find this in your documents.*
5. During a temporary Groq problem you may see this in the console, while the app still answers:
   ```
   Groq request failed (429). Retry 1/2 in 1000 ms
   ```

## Evaluate
Copy `server/eval.example.json` to `server/eval.json` and replace it with your own questions. Answerable ones have `doc` and `page`, unanswerable ones have `"answerable": false`. Run `npm run eval` in `server`. It reports retrieval hit@k and how many unanswerable questions were correctly rejected. Compare different `MIN_SCORE` values and chunk sizes (`chunkText` in `rag.js`).

## Project structure
```
server/index.js   API routes, Groq call, error handler
server/rag.js     PDF parsing, chunking, local embeddings, retrieval
server/util.js    HttpError and retry with backoff
server/eval.js    retrieval evaluation script
client/src/App.jsx   the UI
```

## Limits
Text-based PDFs only (scanned pages need OCR first). The vector index is a JSON file in `server/data/`, which is fine for a few hundred pages.
