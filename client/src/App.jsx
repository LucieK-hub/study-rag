import { useEffect, useRef, useState } from 'react';

async function api(url, opts) {
  let r;
  try { r = await fetch(url, opts); } catch { throw new Error('Cannot reach the server. Is it running on port 3001?'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
  return d;
}

export default function App() {
  const [docs, setDocs] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const end = useRef();

  const load = () => api('/api/docs').then(setDocs).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  async function upload(e) {
    const f = e.target.files[0];
    if (!f) return;
    setErr('');
    setBusy(`Indexing ${f.name}. The first upload is slow while the embedding model downloads.`);
    const fd = new FormData();
    fd.append('file', f);
    try { await api('/api/upload', { method: 'POST', body: fd }); await load(); } catch (x) { setErr(x.message); }
    setBusy('');
    e.target.value = '';
  }

  async function remove(name) {
    setDocs(await api('/api/docs/' + encodeURIComponent(name), { method: 'DELETE' }));
  }

  async function ask(e) {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    setQ('');
    setErr('');
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setBusy('Searching your documents…');
    try {
      const d = await api('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
      setMsgs((m) => [...m, { role: 'bot', text: d.answer, sources: d.sources }]);
    } catch (x) { setErr(x.message); }
    setBusy('');
  }

  return (
    <div className="app">
      <aside>
        <h1>Study Assistant</h1>
        <label className="upload">
          Add a PDF
          <input type="file" accept="application/pdf" onChange={upload} disabled={!!busy} hidden />
        </label>
        <ul>
          {docs.map((d) => (
            <li key={d}>
              <span title={d}>{d}</span>
              <button onClick={() => remove(d)} aria-label={`Remove ${d}`}>Remove</button>
            </li>
          ))}
        </ul>
        {!docs.length && <p className="hint">Add your notes or slides as PDF, then ask a question about them.</p>}
      </aside>
      <main>
        <div className="chat">
          {msgs.map((m, i) => (
            <div key={i} className={'msg ' + m.role}>
              <p>{m.text}</p>
              {m.sources?.map((s, j) => (
                <details key={j}>
                  <summary>[{j + 1}] {s.doc}, page {s.page}</summary>
                  <mark>{s.text}</mark>
                </details>
              ))}
            </div>
          ))}
          {busy && <p className="hint">{busy}</p>}
          {err && <p className="error">{err}</p>}
          <div ref={end} />
        </div>
        <form onSubmit={ask}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your documents" disabled={!docs.length} />
          <button disabled={!docs.length || !!busy}>Ask</button>
        </form>
      </main>
    </div>
  );
}
