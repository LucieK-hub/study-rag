export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Rate limits (429), timeouts (408), server errors (5xx) and network drops are worth retrying.
// Bad keys (401), bad requests (400) and missing models (404) are not.
const transient = (e) =>
  e.status === 408 || e.status === 429 || e.status >= 500 ||
  /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|connection|timed out/i.test(`${e.code || ''} ${e.message}`);

// Retries with exponential backoff (1 s, 2 s, ...). Honors the Retry-After header when the API sends one.
export async function withRetry(fn, { retries = 2, baseMs = 1000, label = 'Request' } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= retries || !transient(e)) throw e;
      const ra = Number(e.headers?.['retry-after'] ?? e.headers?.get?.('retry-after'));
      const wait = Math.min(ra > 0 ? ra * 1000 : baseMs * 2 ** attempt, 10000);
      console.warn(`${label} failed (${e.status || e.code || e.message}). Retry ${attempt + 1}/${retries} in ${wait} ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
