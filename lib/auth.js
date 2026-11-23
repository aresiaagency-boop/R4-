// Sesión de la plataforma R4 (sin dependencias).
// Variables de entorno (Vercel → Settings → Environment Variables):
//   R4_PANEL_PASSWORD  contraseña de Dirección para entrar en la plataforma (mín. 8 caracteres)
//   R4_API_KEY         secreto compartido con n8n (cabecera x-r4-key del flujo «R4 · API», mín. 16)
//   N8N_API_URL        opcional; por defecto el webhook de producción de r4-n8n
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';

const COOKIE = 'r4_session';
const TTL_S = 12 * 60 * 60;
export const DEFAULT_N8N_API_URL = 'https://r4-n8n.7dklrk.easypanel.host/webhook/r4-api';

export function env() {
  return {
    password: process.env.R4_PANEL_PASSWORD || '',
    apiKey: process.env.R4_API_KEY || '',
    n8nUrl: process.env.N8N_API_URL || DEFAULT_N8N_API_URL
  };
}
export const isConfigured = () => { const e = env(); return e.password.length >= 8 && e.apiKey.length >= 16; };

const hmacKey = () => { const e = env(); return createHash('sha256').update('r4-session|' + e.password + '|' + e.apiKey).digest(); };
export function sign(exp) { return exp + '.' + createHmac('sha256', hmacKey()).update(String(exp)).digest('base64url'); }
export function verifyToken(token, now = Date.now()) {
  if (!token || typeof token !== 'string' || !isConfigured()) return false;
  const [exp, mac] = token.split('.');
  if (!/^\d+$/.test(exp || '') || !mac) return false;
  if (Number(exp) * 1000 < now) return false;
  return safeEqual(sign(exp), token);
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
export const isAuthed = (req) => verifyToken(readCookie(req));
export function setSession(res) {
  const exp = Math.floor(Date.now() / 1000) + TTL_S;
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(sign(exp))}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL_S}`);
}
export function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}
/** Rechaza peticiones de escritura que vengan de otro origen (CSRF). */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
export async function readBody(req) {
  if (req.body !== undefined) return typeof req.body === 'string' ? safeJson(req.body) : (req.body || {});
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return safeJson(Buffer.concat(chunks).toString('utf8'));
}
const safeJson = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
