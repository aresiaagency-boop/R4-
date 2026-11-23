// Puerta de datos de la plataforma: valida sesión y operación, y reenvía a n8n («R4 · API»),
// que ejecuta SELECT r4_api(...) en Postgres y, si toca, envía el WhatsApp por Evolution API.
//   GET  /api/r4?op=summary
//   POST /api/r4  { op, id?, etapa?, extraccion?, config? }
import { env, isConfigured, isAuthed, sameOrigin, send, readBody } from '../lib/auth.js';

const OPS = new Set(['summary', 'set_config', 'update_extraccion', 'set_etapa', 'update_inmueble', 'reenviar_wa', 'marcar_cliente', 'marcar_ignorado']);
const ETAPAS = new Set(['nuevo', 'contactado', 'visita', 'presupuesto', 'aceptado', 'perdido']);
const CONFIG_KEYS = new Set(['evolution_url', 'evolution_instancia', 'wa_destino_direccion', 'wa_campos', 'eco_activo', 'gmail_cuenta', 'plataforma_url']);
const EXTR_KEYS = new Set(['nombre', 'empresa', 'email', 'telefono', 'servicio', 'urgencia', 'solicita', 'tipo_cliente', 'direccion_obra', 'municipio', 'titulo', 'resumen']);

const pick = (obj, keys, max = 1000) => Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {})
  .filter(([k, v]) => keys.has(k) && (typeof v === 'string' || typeof v === 'boolean'))
  .map(([k, v]) => [k, String(v).slice(0, max)]));

export function buildPayload(input) {
  const op = String((input && input.op) || 'summary');
  if (!OPS.has(op)) return { error: 'operación no permitida' };
  const p = { op };
  if (['update_extraccion', 'set_etapa', 'update_inmueble', 'reenviar_wa', 'marcar_cliente', 'marcar_ignorado'].includes(op)) {
    const id = Number(input.id);
    if (!Number.isInteger(id) || id <= 0) return { error: 'id no válido' };
    p.id = id;
  }
  if (op === 'set_etapa') {
    if (!ETAPAS.has(input.etapa)) return { error: 'etapa no válida' };
    p.etapa = input.etapa;
    if (input.etapa === 'perdido' && typeof input.motivo === 'string') p.motivo = input.motivo.slice(0, 300);
  }
  if (op === 'update_inmueble') {
    const a = String(input.anio_construccion || ''), f = String(input.iee_fecha || '');
    if (a && !/^(1[5-9]|20)\d{2}$/.test(a)) return { error: 'año de construcción no válido' };
    if (f && !/^\d{4}-\d{2}-\d{2}$/.test(f)) return { error: 'fecha de IEE no válida' };
    p.anio_construccion = a; p.iee_fecha = f; p.tipo_estructura = String(input.tipo_estructura || '').slice(0, 120);
  }
  if (op === 'update_extraccion') p.extraccion = pick(input.extraccion, EXTR_KEYS, 2000);
  if (op === 'set_config') {
    p.config = pick(input.config, CONFIG_KEYS, 500);
    if (p.config.evolution_url && !/^https?:\/\/\S+$/.test(p.config.evolution_url)) return { error: 'URL de Evolution no válida' };
    if (p.config.plataforma_url && !/^https:\/\/\S+$/.test(p.config.plataforma_url)) return { error: 'URL de la plataforma no válida' };
  }
  return { payload: p };
}

export default async function handler(req, res) {
  if (!isConfigured()) return send(res, 503, { error: 'acceso no configurado' });
  if (!isAuthed(req)) return send(res, 401, { error: 'sesión no válida' });
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'método no permitido' }); }
  if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'origen no permitido' });

  const input = req.method === 'GET'
    ? { op: (req.query && req.query.op) || new URL(req.url, 'http://local').searchParams.get('op') || 'summary' }
    : await readBody(req);
  const { payload, error } = buildPayload(input);
  if (error) return send(res, 400, { error });

  const { n8nUrl, apiKey } = env();
  let r;
  try {
    r = await fetch(n8nUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-r4-key': apiKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000)
    });
  } catch (e) {
    return send(res, 502, { error: 'n8n no responde', detail: String((e && e.message) || e).slice(0, 200) });
  }
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = null; }
  if (!r.ok || !data) {
    const hint = r.status === 404 ? 'el flujo «R4 · API» no está publicado en n8n'
      : (r.status === 401 || r.status === 403) ? 'R4_API_KEY no coincide con la credencial «R4 API key» de n8n'
      : 'respuesta no válida de n8n';
    return send(res, 502, { error: hint, status: r.status });
  }
  if (data.ok === false) return send(res, 400, { error: data.error || 'error en la operación' });
  return send(res, 200, data);
}
