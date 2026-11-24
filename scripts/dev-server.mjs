// Servidor local que imita Vercel: sirve public/ y enruta /api/* a las funciones.
// Uso: R4_PANEL_PASSWORD=... R4_API_KEY=... N8N_API_URL=http://localhost:5679/webhook/r4-api npm run dev
// Para probar sin n8n real: arrancar antes  node scripts/mock-n8n.mjs  (usa Postgres local).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const routes = { '/api/session': '../api/session.js', '/api/r4': '../api/r4.js', '/api/auth/google': '../api/auth/google.js', '/api/auth/callback': '../api/auth/callback.js' };

// MOCK_GOOGLE=1 (solo local): simula los endpoints de token de Google. El navegador de pruebas intercepta
// accounts.google.com y vuelve al callback con code=<email en base64url>.
if (process.env.MOCK_GOOGLE === '1') {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/tokeninfo')) {
      const email = Buffer.from(new URL(u).searchParams.get('id_token'), 'base64url').toString();
      const nombre = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return new Response(JSON.stringify({ aud: process.env.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', email, email_verified: 'true', name: nombre, exp: String(Math.floor(Date.now() / 1000) + 600) }));
    }
    if (u.startsWith('https://oauth2.googleapis.com/token')) {
      const code = new URLSearchParams(o.body.toString()).get('code');
      return new Response(JSON.stringify({ id_token: code }));
    }
    return real(url, o);
  };
  console.log('MOCK_GOOGLE activo (solo pruebas locales)');
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (routes[url.pathname]) {
    req.query = Object.fromEntries(url.searchParams);
    try { const mod = await import(routes[url.pathname]); return await mod.default(req, res); }
    catch (e) { console.error(e); res.statusCode = 500; return res.end('error'); }
  }
  const file = normalize(join(root, 'public', url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(join(root, 'public'))) { res.statusCode = 403; return res.end(); }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch { res.statusCode = 404; res.end('no encontrado'); }
}).listen(PORT, () => console.log(`R4 dev → http://localhost:${PORT}`));
