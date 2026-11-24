// POST /api/doc  { nombre, tipo, datos(base64) } → n8n «R4 · Documentos IA» → { ok, documento }
// Lee facturas, albaranes y tickets (PDF o foto) para proponer un coste. No escribe en la base de datos:
// la persona revisa y guarda con /api/r4 (op coste_add).
import { env, isConfigured, isAuthed, sameOrigin, send, readBody, n8n, clearCookie } from '../lib/auth.js';
import { actorDe } from './r4.js';

const ROLES_DOC = new Set(['direccion', 'tecnico', 'administracion', 'encargado']);
const TIPOS = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export const docUrl = () => process.env.N8N_DOC_URL || env().n8nUrl.replace(/r4-api\/?$/, 'r4-doc');

export default async function handler(req, res) {
  if (!isConfigured()) return send(res, 503, { error: 'acceso no configurado' });
  const user = isAuthed(req);
  if (!user) return send(res, 401, { error: 'sesión no válida' });
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'método no permitido' }); }
  if (!sameOrigin(req)) return send(res, 403, { error: 'origen no permitido' });
  if (!ROLES_DOC.has(user.r)) return send(res, 403, { error: 'tu rol no registra facturas' });
  const b = await readBody(req);
  const tipo = String(b.tipo || ''), datos = String(b.datos || '');
  if (!TIPOS.has(tipo)) return send(res, 400, { error: 'formato no admitido: PDF, JPG, PNG o WEBP' });
  if (!datos || datos.length > 4400000 || !/^[A-Za-z0-9+/=]+$/.test(datos)) return send(res, 400, { error: 'archivo vacío o de más de 3 MB' });
  // Rol VIGENTE en la base de datos (no el de la cookie), límite por hora y registro de la lectura
  try {
    const perm = await n8n({ op: 'doc_permiso', nombre: String(b.nombre || '').slice(0, 80), actor: actorDe(user) });
    const pd = perm.data || {};
    if (pd.auth === false) { res.setHeader('Set-Cookie', clearCookie()); return send(res, 401, { error: pd.error || 'acceso retirado' }); }
    if (!perm.ok || pd.ok === false) return send(res, pd.forbidden ? 403 : 429, { error: pd.error || 'no autorizado' });
  } catch (e) { return send(res, 502, { error: 'n8n no responde' }); }
  let r;
  try {
    r = await fetch(docUrl(), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-r4-key': env().apiKey },
      body: JSON.stringify({ nombre: String(b.nombre || 'documento').slice(0, 120), tipo, datos }),
      signal: AbortSignal.timeout(58000)
    });
  } catch (e) { return send(res, 502, { error: 'el lector de documentos no responde' }); }
  let data = null; try { data = await r.json(); } catch { /* no JSON */ }
  if (r.status === 404) return send(res, 502, { error: 'el flujo «R4 · Documentos IA» no está publicado en n8n' });
  if (!r.ok || !data) return send(res, 502, { error: 'respuesta no válida del lector', status: r.status });
  if (data.ok === false) return send(res, 422, { error: data.error || 'no se pudo leer el documento' });
  const d = data.documento || {};
  const n = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : 0);
  const t = (v, m) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, m);
  return send(res, 200, { ok: true, documento: {
    proveedor: t(d.proveedor, 120), fecha: /^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '') ? d.fecha : '', numero: t(d.numero, 60), codigo_obra: t(d.codigo_obra, 40),
    tipo_documento: t(d.tipo_documento, 20), categoria: t(d.categoria, 30), tipo_coste: d.tipo_coste === 'indirecto' ? 'indirecto' : 'directo',
    base_imponible: n(d.base_imponible), iva: n(d.iva), total: n(d.total),
    lineas: Array.isArray(d.lineas) ? d.lineas.slice(0, 12).map((l) => ({ concepto: t(l && l.concepto, 200), importe: n(l && l.importe) })) : []
  } });
}
