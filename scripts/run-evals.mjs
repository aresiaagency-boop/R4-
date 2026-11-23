// Evaluación de ECO: ejecuta los casos reales de eval/eco-extraccion.jsonl contra el MISMO
// prompt y esquema que usa n8n (n8n/eco-prompt.mjs) y los califica de forma determinista.
// Uso: OPENAI_API_KEY=... npm run eval            (umbral: EVAL_MIN=0.9 por defecto)
// Añadir un caso: cada correo que ECO clasifique mal → una línea nueva en el .jsonl.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { ecoRequestBody, ECO_VERSION } from '../n8n/eco-prompt.mjs';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('Falta OPENAI_API_KEY'); process.exit(2); }
const MIN = Number(process.env.EVAL_MIN || 0.9);
const cases = readFileSync(new URL('../eval/eco-extraccion.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function grade(exp, got) {
  const fails = [];
  for (const [k, v] of Object.entries(exp)) {
    if (k.endsWith('_contiene')) { const f = k.replace('_contiene', ''); if (!norm(got[f]).includes(norm(v))) fails.push(`${f}∌«${v}» (=${got[f]})`); }
    else if (got[k] !== v) fails.push(`${k}=${JSON.stringify(got[k])}≠${JSON.stringify(v)}`);
  }
  return fails;
}

const rows = [];
for (const c of cases) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(ecoRequestBody(c.input))
  });
  const j = await r.json();
  let got = {};
  try { got = JSON.parse(j.choices[0].message.content); } catch { got = { error: j.error && j.error.message }; }
  const fails = grade(c.expect, got);
  rows.push({ id: c.id, ok: fails.length === 0, fails, got });
  console.log(`${fails.length ? '✗' : '✓'} ${c.id}${fails.length ? ' · ' + fails.join(' · ') : ''}`);
}
const score = rows.filter((r) => r.ok).length / rows.length;
mkdirSync(new URL('../eval/results/', import.meta.url), { recursive: true });
const file = new URL(`../eval/results/${new Date().toISOString().slice(0, 10)}-${ECO_VERSION}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ version: ECO_VERSION, score, rows }, null, 2));
console.log(`\nECO ${ECO_VERSION}: ${(score * 100).toFixed(0)} % (${rows.filter((r) => r.ok).length}/${rows.length}) · umbral ${MIN * 100} %`);
process.exit(score >= MIN ? 0 : 1);
