// Usage: npm run eval [k]   (reads eval.json, see eval.example.json)
import 'dotenv/config';
import fs from 'fs';
import { retrieve } from './rag.js';

const set = JSON.parse(fs.readFileSync('eval.json', 'utf8'));
const K = +process.argv[2] || 4;
const MIN = +process.env.MIN_SCORE || 0.8;
let hits = 0, answerable = 0, rejected = 0, unanswerable = 0;

for (const t of set) {
  const r = await retrieve(t.question, K);
  if (t.answerable === false) {
    unanswerable++;
    const ok = r[0].score < MIN;
    rejected += ok;
    console.log(ok ? 'OK  ' : 'FAIL', 'unanswerable:', t.question, `(top score ${r[0].score.toFixed(3)})`);
  } else {
    answerable++;
    const ok = r.some((h) => h.doc === t.doc && h.page === t.page);
    hits += ok;
    console.log(ok ? 'OK  ' : 'FAIL', t.question, `(top score ${r[0].score.toFixed(3)})`);
  }
}
console.log(`\nRetrieval hit@${K}: ${hits}/${answerable}`);
console.log(`Correctly refused: ${rejected}/${unanswerable} (MIN_SCORE=${MIN})`);
