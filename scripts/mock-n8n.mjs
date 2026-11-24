// Doble local del flujo n8n «R4 · API» para pruebas (NO se despliega).
// POST /webhook/r4-api con cabecera x-r4-key → SELECT r4_api(...) en Postgres local vía psql.
// Si la respuesta pide enviar WhatsApp, simula Evolution (MOCK_WA=fail para simular un fallo).
// Uso: R4_API_KEY=... PGDATABASE=r4test node scripts/mock-n8n.mjs
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';

const KEY = process.env.R4_API_KEY || '';
const PORT = Number(process.env.MOCK_PORT || 5679);
const sql = (fn, payload) => {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', `p=${JSON.stringify(payload)}`], {
    input: `SELECT ${fn}(:'p'::jsonb);\n`, encoding: 'utf8', env: process.env
  });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.trim());
};

createServer(async (req, res) => {
  if (req.method !== 'POST' || !['/webhook/r4-api', '/webhook/r4-doc'].includes(req.url)) { res.statusCode = 404; return res.end('{"message":"not registered"}'); }
  if (req.headers['x-r4-key'] !== KEY) { res.statusCode = 403; return res.end('Authorization data is wrong!'); }
  const chunks = []; for await (const c of req) chunks.push(c);
  if (req.url === '/webhook/r4-doc') {   // lector de documentos simulado (sin OpenAI)
    const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(b.datos ? { ok: true, documento: { proveedor: 'Morteros Técnicos Baleares', fecha: '2026-11-20', numero: 'FA-2611-0457', codigo_obra: '36', tipo_documento: 'factura', categoria: 'material', tipo_coste: 'directo', base_imponible: 642.5, iva: 134.93, total: 777.43, lineas: [{ concepto: 'Mortero de reparación (25 sacos)', importe: 512.5 }, { concepto: 'Puente de unión epoxi', importe: 130 }] } } : { ok: false, error: 'archivo no válido' }));
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    let r = sql('r4_api', body);
    if (r.enviar_wa === true) {
      const ok = process.env.MOCK_WA !== 'fail';
      sql('r4_marcar_wa', { id: r.id, ok, detalle: ok ? '' : 'MOCK: Evolution respondió 401' });
      r = Object.assign({}, r, { wa_enviado: ok });
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(r));
  } catch (e) { console.error(e.message); res.statusCode = 500; res.end('{"message":"Error in workflow"}'); }
}).listen(PORT, () => console.log(`mock n8n → http://localhost:${PORT}/webhook/r4-api`));
