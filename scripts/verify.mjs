// VERIFIER · evidencia visual + comprobaciones de la plataforma R4.
// Recorre todas las secciones en modo demostración y (si hay contraseña) en vivo,
// guarda capturas en screenshots/ y falla si hay errores de consola o aserciones rotas.
// Uso: R4_URL=http://localhost:3000 R4_PANEL_PASSWORD=... npm run verify
//      R4_MOCK_GOOGLE=1 VERIFY_DIRECCION=jefe@r4.test …    (login con Google simulado: dev-server con MOCK_GOOGLE=1)
//      R4_URL=https://r4-xxx.vercel.app npm run verify          (solo modo demostración)
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const URL0 = (process.env.R4_URL || 'http://localhost:3000').replace(/\/$/, '');
const PASS = process.env.R4_PANEL_PASSWORD || '';
const OUT = process.env.R4_SHOTS || 'screenshots';
const MOCK_G = process.env.R4_MOCK_GOOGLE === '1';
const DIR = process.env.VERIFY_DIRECCION || '';
const SECTIONS = ['mission-control', 'crm', 'bandeja', 'presupuestos', 'obras', 'planning', 'costes', 'facturacion', 'finanzas', 'atlas', 'configuracion', 'hoja-de-ruta', 'equipo'];
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' · ' + detail : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// Google simulado: se intercepta /api/auth/google (Playwright no intercepta destinos de redirección)
// y se salta la pantalla de Google volviendo al callback con code = email (base64url) y el state real.
async function conGoogle(p, email) {
  await p.route('**/api/auth/google', async (route) => {
    const r = await route.fetch({ maxRedirects: 0 });
    const g = new URL(r.headers()['location']);
    const back = `${g.searchParams.get('redirect_uri')}?code=${Buffer.from(email).toString('base64url')}&state=${g.searchParams.get('state')}`;
    await route.fulfill({ status: 302, headers: { location: back, 'set-cookie': r.headers()['set-cookie'] } });
  });
}
async function entrar(p, email, boton) {
  await p.unrouteAll({ behavior: 'ignoreErrors' }); await conGoogle(p, email);
  await p.goto(`${URL0}/#acceso`, { waitUntil: 'networkidle' });
  await p.waitForSelector('#portal:not([hidden])');
  await Promise.all([p.waitForURL((u) => /acceso=|#mission-control/.test(String(u)), { timeout: 15000 }), p.click(boton)]);
  await p.waitForLoadState('networkidle');
}
async function salir(p) { await p.click('#exit-btn'); await p.waitForSelector('#portal:not([hidden])'); }
const enVivo = (p) => p.waitForFunction(() => document.querySelector('#src-pill').textContent.startsWith('En vivo'), null, { timeout: 30000 });

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

// 2) Modo en vivo · login con Google y control de Dirección
if (MOCK_G && DIR) {
  const nuevo = `tecnico.${Date.now()}@gmail.example`;
  await page.goto(URL0, { waitUntil: 'networkidle' });
  await page.waitForSelector('#portal:not([hidden])');
  check('portal: «Entrar con Google» para Dirección y Equipo', await page.locator('.g-btn').count() === 2);
  check('portal: acceso de emergencia con contraseña', await page.locator('#portal-pass').count() === (PASS ? 1 : 0));
  await page.screenshot({ path: `${OUT}/portal-acceso.png` });

  // a) alguien del equipo entra con Google → queda pendiente, sin datos
  await entrar(page, nuevo, '#portal-eq');
  check('equipo nuevo → «pendiente de aprobación»', /Solicitud enviada/.test(await page.textContent('#portal-msg').catch(() => '')));
  const s1 = await page.evaluate(() => fetch('/api/session').then((r) => r.json()));
  check('pendiente: sin sesión', s1.authenticated === false);
  await page.screenshot({ path: `${OUT}/portal-pendiente.png` });

  // b) Dirección entra con Google → control total, ve la solicitud
  await entrar(page, DIR, '#portal-dir');
  await enVivo(page);
  check('Dirección: sesión Google en vivo', /Dirección$/.test(await page.textContent('#who')), await page.textContent('#who'));
  check('Dirección: aviso de solicitudes en la barra', await page.isVisible('#eq-badge'));
  await shootAll('live');
  await page.goto(`${URL0}/#equipo`, { waitUntil: 'networkidle' }); await enVivo(page);
  check('Equipo: solicitud del nuevo usuario visible', await page.locator(`[data-eq="aprobar"][data-email="${nuevo}"]`).count() === 1);
  await page.screenshot({ path: `${OUT}/live-equipo-solicitud.png`, fullPage: true });
  await page.selectOption(`select[data-eq-pend="${nuevo}"]`, 'tecnico');
  await page.click(`[data-eq="aprobar"][data-email="${nuevo}"]`);
  await page.waitForSelector(`select[data-eq-rol="${nuevo}"]`, { timeout: 15000 });
  check('Dirección aprueba con rol Técnico', (await page.inputValue(`select[data-eq-rol="${nuevo}"]`)) === 'tecnico');
  await page.screenshot({ path: `${OUT}/live-equipo-aprobado.png`, fullPage: true });

  // c) el técnico entra en otro navegador: edita CRM, pero no ve Equipo ni toca ajustes
  const ctxT = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pt = await ctxT.newPage();
  await entrar(pt, nuevo, '#portal-eq'); await enVivo(pt);
  check('Técnico: entra con su rol', /Técnico/.test(await pt.textContent('#who')), await pt.textContent('#who'));
  check('Técnico: «Equipo y accesos» oculto', await pt.locator('#nav [data-id="equipo"]').isHidden());
  const cfg = await pt.evaluate(() => fetch('/api/r4', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'set_config', config: { eco_activo: 'true' } }) }).then((r) => r.status));
  check('Técnico: ajustes bloqueados en el servidor (403)', cfg === 403, String(cfg));
  await pt.goto(`${URL0}/#configuracion`, { waitUntil: 'networkidle' });
  await pt.screenshot({ path: `${OUT}/live-tecnico.png`, fullPage: true });

  // d) Dirección retira el acceso → el técnico queda fuera en su siguiente acción
  await page.click(`[data-eq="bloquear"][data-email="${nuevo}"]`);
  check('retirar acceso pide confirmación (dos toques)', /Toca otra vez/.test(await page.textContent(`[data-eq="bloquear"][data-email="${nuevo}"]`)));
  await page.click(`[data-eq="bloquear"][data-email="${nuevo}"]`);
  await page.waitForSelector(`[data-eq="reactivar"][data-email="${nuevo}"]`, { timeout: 15000 });
  check('Dirección retira el acceso', true);
  await pt.evaluate(() => { location.hash = '#crm'; });
  await pt.click('#src-pill').catch(() => {});
  await pt.evaluate(() => fetch('/api/r4?op=summary').then((r) => r.status)).then((st) => check('Técnico bloqueado: 401 inmediato', st === 401, String(st)));
  await pt.reload({ waitUntil: 'networkidle' });
  const sT = await pt.evaluate(() => fetch('/api/session').then((r) => r.json()));
  check('Técnico bloqueado: sesión borrada', sT.authenticated === false);
  await entrar(pt, nuevo, '#portal-eq');
  check('Técnico bloqueado: Google ya no da acceso', /Acceso retirado/.test(await pt.textContent('#portal-msg').catch(() => '')));
  await pt.screenshot({ path: `${OUT}/portal-bloqueado.png` });
  await ctxT.close();
  errors.length = 0; // 401/403 de las pruebas negativas son esperados

  // e) móvil (Dirección)
  await page.setViewportSize({ width: 390, height: 844 });
  for (const sec of ['equipo', 'bandeja']) {
    await page.goto(`${URL0}/#${sec}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${OUT}/live-movil-${sec}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`móvil ${sec} sin scroll horizontal`, overflow <= 1, `${overflow}px`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await salir(page);
}
if (PASS) {
  await page.goto(`${URL0}/#acceso`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#portal:not([hidden])');
  await page.click(MOCK_G ? '#portal-pass' : '#portal-dir');
  await page.fill('#login-pass', 'contraseña-mala');
  await page.click('#login-submit');
  await page.waitForSelector('#login-err:not([hidden])');
  check('emergencia: rechaza contraseña incorrecta', (await page.textContent('#login-err')).includes('incorrecta'));
  errors.length = 0;
  await page.fill('#login-pass', PASS);
  await page.click('#login-submit');
  await enVivo(page);
  check('emergencia: Dirección con contraseña en vivo', /emergencia/.test(await page.textContent('#who')));
  if (!MOCK_G) await shootAll('live');
  await page.goto(`${URL0}/#bandeja`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-live-msg]', { timeout: 15000 }).catch(() => {});
  const n = await page.locator('[data-live-msg]').count();
  const firstClient = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-live-msg]')]; return b.length ? b[b.length - 1].dataset.liveMsg : null; });
  if (firstClient) { await page.click(`[data-live-msg="${firstClient}"]`); await page.waitForTimeout(200); }
  check('bandeja lista mensajes reales', n > 0, `${n} mensajes`);
  await page.screenshot({ path: `${OUT}/live-bandeja-detalle.png`, fullPage: true });
  const editBtn = page.locator('[data-lact="editar"]');
  if (await editBtn.count()) { await editBtn.first().click(); check('formulario de corrección', await page.locator('#edit-form').count() === 1); await page.click('[data-lact="cancelar"]'); }
}

// Guía de implantación: botón ON/OFF, panel y plan
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${URL0}/#mission-control`, { waitUntil: 'networkidle' });
if (await page.$('.g-fab')) {
  if ((await page.getAttribute('.g-fab', 'aria-pressed')) !== 'true') await page.click('.g-fab');
  check('guía: se enciende y muestra el panel', !!(await page.waitForSelector('.g-dock', { timeout: 5000 }).catch(() => null)));
  await page.click('[data-g="plan"]');
  check('guía: plan completo con cálculos', !!(await page.waitForSelector('.g-plan .g-out', { timeout: 5000 }).catch(() => null)));
  await page.screenshot({ path: `${OUT}/guia-plan.png` });
  await page.click('[data-p="cerrar"]'); await page.click('.g-fab');
  check('guía: se apaga', (await page.getAttribute('.g-fab', 'aria-pressed')) === 'false' && !(await page.$('.g-dock')));
} else check('guía: botón presente', false);

check('sin errores de consola', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
writeFileSync(`${OUT}/verify-report.json`, JSON.stringify({ url: URL0, at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK · capturas en ${OUT}/`);
process.exit(failed.length ? 1 : 0);
