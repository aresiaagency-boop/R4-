// GET /api/auth/callback?code&state → valida con Google, registra o comprueba el usuario en Postgres (vía n8n)
// y abre sesión solo si Dirección lo ha aprobado. Las cuentas de R4_DIRECCION_EMAILS entran siempre como Dirección.
import { env, googleEnabled, readState, clearStateCookie, sessionCookie, baseUrl, redirect, safeEqual, direccionEmails, n8n } from '../../lib/auth.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

export async function verificarGoogle(code, redirectUri, verifier) {
  const { googleId, googleSecret } = env();
  const t = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: googleId, client_secret: googleSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
    signal: AbortSignal.timeout(15000)
  }).then((r) => r.json());
  if (!t || !t.id_token) throw new Error('google_token');
  const info = await fetch(TOKENINFO_URL + '?id_token=' + encodeURIComponent(t.id_token), { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
  if (!info || info.aud !== googleId) throw new Error('google_aud');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) throw new Error('google_iss');
  if (!(info.email_verified === true || info.email_verified === 'true')) throw new Error('google_email');
  if (Number(info.exp) * 1000 < Date.now()) throw new Error('google_exp');
  return { email: String(info.email).toLowerCase(), nombre: info.name || '', foto: info.picture || '' };
}

export default async function handler(req, res) {
  const base = baseUrl(req);
  const fin = (estado, cookies = []) => redirect(res, `${base}/?acceso=${estado}`, [clearStateCookie(), ...cookies]);
  if (!googleEnabled()) return fin('no_configurado');
  const url = new URL(req.url, base);
  const code = url.searchParams.get('code'), state = url.searchParams.get('state');
  if (url.searchParams.get('error')) return fin('cancelado');
  const [esperado, verifier] = String(readState(req) || '').split('.');
  if (!code || !state || !esperado || !verifier || !safeEqual(state, esperado)) return fin('error');
  try {
    const g = await verificarGoogle(code, base + '/api/auth/callback', verifier);
    const r = await n8n({ op: 'auth_login', email: g.email, nombre: g.nombre, foto: g.foto, direccion: direccionEmails().includes(g.email) });
    const u = r.data;
    if (!r.ok || !u || u.ok === false || String(u.email || '').toLowerCase() !== g.email) return fin('error');
    if (u.estado !== 'activo') return fin(u.estado === 'bloqueado' ? 'bloqueado' : 'pendiente');
    return redirect(res, `${base}/#mission-control`, [clearStateCookie(), sessionCookie({ e: g.email, n: u.nombre || g.nombre, r: u.rol, v: 'google' })]);
  } catch (e) {
    return fin('error');
  }
}
