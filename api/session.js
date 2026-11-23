// GET    /api/session  → { configured, authenticated }
// POST   /api/session  { password } → abre sesión (cookie HttpOnly 12 h)
// DELETE /api/session  → cierra sesión
import { env, isConfigured, isAuthed, safeEqual, setSession, clearSession, sameOrigin, send, readBody } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'GET') return send(res, 200, { configured: isConfigured(), authenticated: isAuthed(req) });
  if (!sameOrigin(req)) return send(res, 403, { error: 'origen no permitido' });
  if (req.method === 'DELETE') { clearSession(res); return send(res, 200, { ok: true }); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, DELETE'); return send(res, 405, { error: 'método no permitido' }); }
  if (!isConfigured()) return send(res, 503, { error: 'acceso no configurado: faltan R4_PANEL_PASSWORD y R4_API_KEY' });
  const { password } = await readBody(req);
  if (typeof password !== 'string' || !safeEqual(password, env().password)) {
    await new Promise((r) => setTimeout(r, 700));
    return send(res, 401, { error: 'contraseña incorrecta' });
  }
  setSession(res);
  return send(res, 200, { ok: true });
}
