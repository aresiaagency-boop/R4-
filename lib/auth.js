// Sesión de la plataforma R4 (sin dependencias).
// Variables de entorno (Vercel → Settings → Environment Variables):
//   R4_API_KEY            secreto compartido con n8n (cabecera x-r4-key del flujo «R4 · API», mín. 16)  · obligatorio
//   GOOGLE_CLIENT_ID      cliente OAuth web «R4 · Plataforma (login)» del proyecto GCP r4-estructuras
//   GOOGLE_CLIENT_SECRET  su secreto
//   R4_DIRECCION_EMAILS   cuentas de Google de Dirección, separadas por coma (siempre entran como Dirección)
//   R4_SESSION_SECRET     recomendado: secreto propio para firmar sesiones (≥ 32 caracteres aleatorios)
//   R4_PANEL_PASSWORD     opcional: acceso de emergencia de Dirección con contraseña (mín. 8)
//   R4_PUBLIC_URL         opcional: URL pública (por defecto, el host de la petición)
//   N8N_API_URL           opcional; por defecto el webhook de producción de r4-n8n
import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';

const COOKIE = 'r4_session';
const STATE_COOKIE = 'r4_oauth_state';
const TTL_S = 12 * 60 * 60;
export const DEFAULT_N8N_API_URL = 'https://r4-n8n.7dklrk.easypanel.host/webhook/r4-api';

export function env() {
  return {
    password: process.env.R4_PANEL_PASSWORD || '',
    apiKey: process.env.R4_API_KEY || '',
    n8nUrl: process.env.N8N_API_URL || DEFAULT_N8N_API_URL,
    googleId: process.env.GOOGLE_CLIENT_ID || '',
    googleSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    publicUrl: (process.env.R4_PUBLIC_URL || '').replace(/\/+$/, '')
  };
}
export const passwordEnabled = () => env().password.length >= 8;
export const googleEnabled = () => { const e = env(); return !!(e.googleId && e.googleSecret); };
export const isConfigured = () => env().apiKey.length >= 16 && (passwordEnabled() || googleEnabled());
export const direccionEmails = () => (process.env.R4_DIRECCION_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export function baseUrl(req) {
  const e = env(); if (e.publicUrl) return e.publicUrl;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (String(host).startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

// Clave de firma: R4_SESSION_SECRET si existe (rotarla cierra todas las sesiones); si no, derivada de contraseña + R4_API_KEY.
const hmacKey = () => {
  const e = env(), sec = process.env.R4_SESSION_SECRET || '';
  return createHash('sha256').update(sec.length >= 32 ? 'r4-session|s|' + sec : 'r4-session|' + e.password + '|' + e.apiKey).digest();
};
const mac = (s) => createHmac('sha256', hmacKey()).update(s).digest('base64url');

/** Token de sesión: base64url(JSON{e,n,r,v,exp}).firma */
export function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + mac(body);
}
export function verifyToken(token, now = Date.now()) {
  if (!token || typeof token !== 'string' || !isConfigured()) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const body = token.slice(0, i);
  if (!safeEqual(mac(body), token.slice(i + 1))) return null;
  let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.exp !== 'number' || p.exp * 1000 < now) return null;
  return p;
}
export function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}
export function readCookie(req, name = COOKIE) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}
/** Devuelve el usuario de la sesión ({e,n,r,v,exp}) o null */
export const isAuthed = (req) => verifyToken(readCookie(req));
export function sessionCookie(user) {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  return `${COOKIE}=${encodeURIComponent(sign({ ...user, exp }))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_S}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export function setSession(res, user) { res.setHeader('Set-Cookie', sessionCookie(user)); }
export function clearSession(res) { res.setHeader('Set-Cookie', clearCookie()); }

/* ---- estado OAuth (anti-CSRF) + PKCE ---- */
export const newState = () => randomBytes(18).toString('base64url');
export const newVerifier = () => randomBytes(32).toString('base64url');
export const challengeDe = (v) => createHash('sha256').update(v).digest('base64url');
export const stateCookie = (v) => `${STATE_COOKIE}=${v}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
export const clearStateCookie = () => `${STATE_COOKIE}=; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
export const readState = (req) => readCookie(req, STATE_COOKIE);

/** Rechaza peticiones de escritura que vengan de otro origen (CSRF). */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
}
export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
export function redirect(res, url, cookies) {
  if (cookies && cookies.length) res.setHeader('Set-Cookie', cookies);
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}
export async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return safeJson(Buffer.concat(chunks).toString('utf8'));
}
const safeJson = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

/** Llamada servidor → n8n «R4 · API» */
export async function n8n(payload) {
  const { n8nUrl, apiKey } = env();
  const r = await fetch(n8nUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-r4-key': apiKey },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25000)
  });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch { /* respuesta no JSON */ }
  return { status: r.status, ok: r.ok, data };
}
