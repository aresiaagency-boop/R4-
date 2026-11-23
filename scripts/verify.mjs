// VERIFIER · evidencia visual + comprobaciones de la plataforma R4.
// Recorre todas las secciones en modo demostración y (si hay contraseña) en vivo,
// guarda capturas en screenshots/ y falla si hay errores de consola o aserciones rotas.
// Uso: R4_URL=http://localhost:3000 R4_PANEL_PASSWORD=... npm run verify
//      R4_URL=https://r4-xxx.vercel.app npm run verify          (solo modo demostración)
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL0 = (process.env.R4_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASS = process.env.R4_PANEL_PASSWORD || '';
const OUT = process.env.R4_SHOTS || 'screenshots';
const SECTIONS = ['mission-control', 'crm', 'bandeja', 'presupuestos', 'obras', 'planning', 'costes', 'facturacion', 'finanzas', 'atlas', 'configuracion', 'hoja-de-ruta'];
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' · ' + detail : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

async function shootAll(prefix) {
  for (const s of SECTIONS) {
    await page.goto(`${URL0}/#${s}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const h1 = await page.textContent('#crumb-name');
    const html = await page.innerHTML('#view');
    check(`${prefix}/${s} renderiza`, html.length > 200 && h1, h1);
    await page.screenshot({ path: `${OUT}/${prefix}-${s}.png`, fullPage: true });
  }
}

// 1) Modo demostración
await page.goto(URL0, { waitUntil: 'networkidle' });
check('título', (await page.title()).includes('R4'));
check('logo carga', await page.evaluate(() => { const i = document.querySelector('.brand img'); return i.complete && i.naturalWidth > 0; }));
const sess = await page.evaluate(() => fetch('/api/session').then((r) => r.json()).catch(() => null));
check('/api/session responde', sess && typeof sess.configured === 'boolean', JSON.stringify(sess));
await shootAll('demo');

// 2) Modo en vivo
if (PASS) {
  await page.goto(URL0, { waitUntil: 'networkidle' });
  await page.waitForSelector('#portal:not([hidden])');
  check('portal «Elige tu acceso» al entrar', true);
  await page.screenshot({ path: `${OUT}/portal-acceso.png` });
  await page.click('#portal-dir');
  await page.fill('#login-pass', 'contraseña-mala');
  await page.click('#login-submit');
  await page.waitForSelector('#login-err:not([hidden])');
  check('login rechaza contraseña incorrecta', (await page.textContent('#login-err')).includes('incorrecta'));
  errors.length = 0; // el 401 de la prueba negativa es esperado
  await page.fill('#login-pass', PASS);
  await page.click('#login-submit');
  await page.waitForFunction(() => document.querySelector('#src-pill').textContent.startsWith('En vivo'), null, { timeout: 30000 });
  check('pill «En vivo» tras login', true);
  await shootAll('live');
  await page.goto(`${URL0}/#bandeja`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-live-msg]', { timeout: 15000 }).catch(() => {});
  const n = await page.locator('[data-live-msg]').count();
  // abrir el primer mensaje de cliente para ver extracción + aviso WhatsApp
  const firstClient = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-live-msg]')]; return b.length ? b[b.length - 1].dataset.liveMsg : null; });
  if (firstClient) { await page.click(`[data-live-msg="${firstClient}"]`); await page.waitForTimeout(200); }
  check('bandeja lista mensajes reales', n > 0, `${n} mensajes`);
  await page.screenshot({ path: `${OUT}/live-bandeja-detalle.png`, fullPage: true });
  // flujo «corregir datos» abre formulario
  const editBtn = page.locator('[data-lact="editar"]');
  if (await editBtn.count()) { await editBtn.first().click(); check('formulario de corrección', await page.locator('#edit-form').count() === 1); await page.click('[data-lact="cancelar"]'); }
  // móvil
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${URL0}/#bandeja`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/live-movil-bandeja.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('móvil sin scroll horizontal', overflow <= 1, `${overflow}px`);
}

check('sin errores de consola', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
writeFileSync(`${OUT}/verify-report.json`, JSON.stringify({ url: URL0, at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK · capturas en ${OUT}/`);
process.exit(failed.length ? 1 : 0);
