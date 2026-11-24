// EVAL · matriz de permisos por rol contra Postgres local (nunca producción).
// Uso: PGDATABASE=r4test node scripts/eval-acceso.mjs   (lee eval/acceso-roles.jsonl)
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const casos = readFileSync(new URL('../eval/acceso-roles.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const lit = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
let ok = 0;
for (const c of casos) {
  const email = `eval.${c.rol}.${c.estado}@r4.test`;
  const sql = `BEGIN;
INSERT INTO usuarios (email, nombre, rol, estado) VALUES ('${email}', 'Eval', '${c.rol}', '${c.estado}')
  ON CONFLICT (email) DO UPDATE SET rol = EXCLUDED.rol, estado = EXCLUDED.estado;
INSERT INTO usuarios (email, rol, estado) VALUES ('otro@r4.test', 'tecnico', 'activo') ON CONFLICT DO NOTHING;
SELECT r4_api(${lit({ op: c.op, ...c.extra, actor: { email, rol: c.rol, via: 'google' } })});
ROLLBACK;`;
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', env: process.env });
  const out = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop() || '{}');
  const obtenido = out.auth === false ? 'sin_acceso' : out.forbidden ? 'prohibido' : 'permitido';
  const pasa = obtenido === c.esperado;
  ok += pasa;
  if (!pasa) console.log(`✗ ${c.caso}: esperado ${c.esperado}, obtenido ${obtenido} · ${JSON.stringify(out).slice(0, 120)}`);
}
console.log(`${ok}/${casos.length} casos de acceso correctos`);
process.exit(ok === casos.length ? 0 : 1);
