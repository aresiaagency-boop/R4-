// Puerta de datos de la plataforma: valida sesión y operación, y reenvía a n8n («R4 · API»),
// que ejecuta SELECT r4_api(...) en Postgres y, si toca, envía el WhatsApp por Evolution API.
//   GET  /api/r4?op=summary
//   POST /api/r4  { op, id?, etapa?, extraccion?, config?, email?, rol?, estado? }
// Cada petición lleva el actor de la sesión ({email, rol, via}); Postgres decide permisos con el rol VIGENTE
// en la tabla usuarios (si Dirección retira o cambia un acceso, aplica en la siguiente petición).
import { env, isConfigured, isAuthed, sameOrigin, send, readBody, clearCookie } from '../lib/auth.js';
import { OPS_GESTION, payloadGestion } from '../lib/gestion.js';

const OPS = new Set(['summary', 'set_config', 'update_extraccion', 'set_etapa', 'update_inmueble', 'reenviar_wa', 'marcar_cliente', 'marcar_ignorado', 'usuario_set']);
export const ROLES = new Set(['direccion', 'tecnico', 'comercial', 'administracion', 'encargado', 'colaborador', 'cliente']);
const ESTADOS = new Set(['activo', 'bloqueado']);
const ETAPAS = new Set(['nuevo', 'contactado', 'visita', 'presupuesto', 'aceptado', 'perdido']);
const CONFIG_KEYS = new Set(['evolution_url', 'evolution_instancia', 'wa_destino_direccion', 'wa_campos', 'eco_activo', 'gmail_cuenta', 'plataforma_url',
  'objetivo_beneficio', 'umbral_ci', 'coste_jornada_oficial', 'coste_jornada_peon', 'dias_nomina', 'correo_materiales', 'ventas_anuales_ref']);
const CONFIG_NUM = new Set(['objetivo_beneficio', 'umbral_ci', 'coste_jornada_oficial', 'coste_jornada_peon', 'dias_nomina']);
const EXTR_KEYS = new Set(['nombre', 'empresa', 'email', 'telefono', 'servicio', 'urgencia', 'solicita', 'tipo_cliente', 'direccion_obra', 'municipio', 'titulo', 'resumen']);

const pick = (obj, keys, max = 1000) => Object.fromEntries(Object.entries(obj && typeof obj === 'object' ? obj : {})
  .filter(([k, v]) => keys.has(k) && (typeof v === 'string' || typeof v === 'boolean'))
  .map(([k, v]) => [k, String(v).slice(0, max)]));

export function buildPayload(input) {
  const op = String((input && input.op) || 'summary');
  if (OPS_GESTION.has(op)) return payloadGestion(op, input);
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
    for (const k of CONFIG_NUM) if (p.config[k] && !/^\d{1,6}([.,]\d{1,2})?$/.test(p.config[k])) return { error: k + ' debe ser un número' };
    if (p.config.ventas_anuales_ref && !/^\d{1,3}(\.?\d{3}){0,3}([.,]\d{1,2})?$/.test(p.config.ventas_anuales_ref)) return { error: 'facturación de referencia no válida' };
    if (p.config.correo_materiales && !/^[^@\s]{1,64}@[^@\s]{1,190}$/.test(p.config.correo_materiales)) return { error: 'correo de materiales no válido' };
  }
  if (op === 'usuario_set') {
    const email = String(input.email || '').trim().toLowerCase();
    if (!/^[^@\s]{1,64}@[^@\s]{1,190}$/.test(email)) return { error: 'email no válido' };
    p.email = email;
    if (input.rol !== undefined) { if (!ROLES.has(input.rol)) return { error: 'rol no válido' }; p.rol = input.rol; }
    if (input.estado !== undefined) { if (!ESTADOS.has(input.estado)) return { error: 'estado no válido' }; p.estado = input.estado; }
    if (input.cliente_id !== undefined && input.cliente_id !== null && input.cliente_id !== '') {
      const c = Number(input.cliente_id); if (!Number.isInteger(c) || c <= 0) return { error: 'cliente no válido' }; p.cliente_id = c;
    }
    if (!p.rol && !p.estado) return { error: 'nada que cambiar' };
  }
  return { payload: p };
}

/** Actor que viaja a Postgres: identidad de la sesión firmada (nunca del cuerpo de la petición). */
export const actorDe = (u) => ({ email: u.v === 'password' ? '' : String(u.e || ''), rol: u.r || '', via: u.v || 'google' });

export default async function handler(req, res) {
  if (!isConfigured()) return send(res, 503, { error: 'acceso no configurado' });
  const user = isAuthed(req);
  if (!user) return send(res, 401, { error: 'sesión no válida' });
  if (req.method !== 'GET' && req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, { error: 'método no permitido' }); }
  if (req.method === 'POST' && !sameOrigin(req)) return send(res, 403, { error: 'origen no permitido' });

  // GET solo lee (summary): con SameSite=Lax una navegación GET desde otra web lleva la cookie
  const input = req.method === 'GET' ? { op: 'summary' } : await readBody(req);
  const { payload, error } = buildPayload(input);
  if (error) return send(res, 400, { error });
  payload.actor = actorDe(user);

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
  if (data.auth === false) { res.setHeader('Set-Cookie', clearCookie()); return send(res, 401, { error: data.error || 'acceso retirado', auth: false }); }
  if (data.ok === false) return send(res, data.forbidden ? 403 : 400, { error: data.error || 'error en la operación' });
  return send(res, 200, data);
}
