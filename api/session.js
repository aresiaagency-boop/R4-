// GET    /api/session  → { configured, google, password, authenticated, user }
// POST   /api/session  { password } → acceso de emergencia de Dirección (si R4_PANEL_PASSWORD existe)
// DELETE /api/session  → cierra sesión
import { env, isConfigured, isAuthed, safeEqual, setSession, clearSession, sameOrigin, send, readBody, googleEnabled, passwordEnabled } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const u = isAuthed(req);
    return send(res, 200, {
      configured: isConfigured(), google: googleEnabled(), password: passwordEnabled(),
      authenticated: !!u, user: u ? { email: u.e, nombre: u.n, rol: u.r, via: u.v } : null
    });
  }
  if (!sameOrigin(req)) return send(res, 403, { error: 'origen no permitido' });
  if (req.method === 'DELETE') { clearSession(res); return send(res, 200, { ok: true }); }
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, DELETE'); return send(res, 405, { error: 'método no permitido' }); }
  if (!isConfigured() || !passwordEnabled()) return send(res, 503, { error: 'acceso con contraseña no activado: entra con Google' });
  const { password } = await readBody(req);
  if (typeof password !== 'string' || !safeEqual(password, env().password)) {
    await new Promise((r) => setTimeout(r, 700));
    return send(res, 401, { error: 'contraseña incorrecta' });
  }
  setSession(res, { e: 'direccion', n: 'Dirección (contraseña)', r: 'direccion', v: 'password' });
  return send(res, 200, { ok: true });
}
