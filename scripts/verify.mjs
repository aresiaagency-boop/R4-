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
const SECTIONS = ['mission-control', 'mi-jornada', 'crm', 'bandeja', 'presupuestos', 'obras', 'planning', 'costes', 'almacen', 'facturacion', 'finanzas', 'atlas', 'configuracion', 'hoja-de-ruta', 'equipo'];
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
  await p.route(/\/api\/auth\/google(\?|$)/, async (route) => {
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
    await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/${prefix}-${s}.png`, fullPage: true });
  }
}

// 1) Modo demostración
await page.goto(URL0, { waitUntil: 'networkidle' });
check('título', (await page.title()).includes('R4'));
check('logo carga', await page.evaluate(() => { const i = document.querySelector('.brand img'); return i.complete && i.naturalWidth > 0; }));
const sess = await page.evaluate(() => fetch('/api/session').then((r) => r.json()).catch(() => null));
check('/api/session responde', sess && typeof sess.configured === 'boolean', JSON.stringify(sess));
await shootAll('demo');
// Demostraciones de las tres puertas del portal
await page.goto(`${URL0}/#acceso`, { waitUntil: 'networkidle' }); await page.waitForSelector('#portal:not([hidden])');
await page.click('#portal-eq-demo'); await page.waitForTimeout(200);
check('demo equipo: entra en Mi jornada como secretaría', /Mi jornada/.test(await page.textContent('#crumb-name')) && /Secretaría|secretaría/.test(await page.textContent('#who')));
check('demo equipo: sin Configuración ni Equipo en la barra', await page.locator('#nav [data-id="configuracion"]').isHidden() && await page.locator('#nav [data-id="equipo"]').isHidden());
await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/demo-equipo-mi-jornada.png`, fullPage: true });
await page.click('#exit-btn'); await page.waitForSelector('#portal:not([hidden])');
await page.click('#portal-cli-demo'); await page.waitForTimeout(200);
check('demo cliente: portal sin barra de secciones', await page.locator('.side').isHidden() && /Obra 36/.test(await page.textContent('#view')));
await page.click('[data-cli-conforme]'); await page.click('[data-cli-conforme]'); await page.waitForTimeout(200);
check('demo cliente: da su conformidad (dos toques)', /Conforme · pendiente de factura/.test(await page.textContent('#view')));
await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/demo-portal-cliente.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/demo-portal-cliente-movil.png`, fullPage: true });
await page.setViewportSize({ width: 1440, height: 900 });
await page.click('#exit-btn'); await page.waitForSelector('#portal:not([hidden])'); await page.click('#portal-demo');

// 2) Modo en vivo · login con Google y control de Dirección
if (MOCK_G && DIR) {
  const nuevo = `tecnico.${Date.now()}@gmail.example`;
  await page.goto(URL0, { waitUntil: 'networkidle' });
  await page.waitForSelector('#portal:not([hidden])');
  check('portal: «Entrar con Google» para Dirección, Equipo y Clientes', await page.locator('.g-btn').count() === 3);
  check('portal: acceso de emergencia con contraseña', await page.locator('#portal-pass').count() === (PASS ? 1 : 0));
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/portal-acceso.png` });

  // a) alguien del equipo entra con Google → queda pendiente, sin datos
  await entrar(page, nuevo, '#portal-eq');
  check('equipo nuevo → «pendiente de aprobación»', /Solicitud enviada/.test(await page.textContent('#portal-msg').catch(() => '')));
  const s1 = await page.evaluate(() => fetch('/api/session').then((r) => r.json()));
  check('pendiente: sin sesión', s1.authenticated === false);
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/portal-pendiente.png` });

  // b) Dirección entra con Google → control total, ve la solicitud
  await entrar(page, DIR, '#portal-dir');
  await enVivo(page);
  check('Dirección: sesión Google en vivo', /Dirección$/.test(await page.textContent('#who')), await page.textContent('#who'));
  check('Dirección: aviso de solicitudes en la barra', await page.isVisible('#eq-badge'));
  await shootAll('live');
  await page.goto(`${URL0}/#equipo`, { waitUntil: 'networkidle' }); await enVivo(page);
  check('Equipo: solicitud del nuevo usuario visible', await page.locator(`[data-eq="aprobar"][data-email="${nuevo}"]`).count() === 1);
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-equipo-solicitud.png`, fullPage: true });
  await page.selectOption(`select[data-eq-pend="${nuevo}"]`, 'tecnico');
  await page.click(`[data-eq="aprobar"][data-email="${nuevo}"]`);
  await page.waitForSelector(`select[data-eq-rol="${nuevo}"]`, { timeout: 15000 });
  check('Dirección aprueba con rol Técnico', (await page.inputValue(`select[data-eq-rol="${nuevo}"]`)) === 'tecnico');
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-equipo-aprobado.png`, fullPage: true });

  // v1.5 · Dirección: obra nueva, parte diario, mod, coste, almacén, Excel, IA, certificación, presupuesto → obra
  await page.goto(`${URL0}/#obras`, { waitUntil: 'networkidle' }); await enVivo(page);
  const cod = 'V' + String(Date.now()).slice(-5);
  await page.click('[data-obra-nueva]');
  await page.fill('#ob-cod', cod); await page.fill('#ob-tit', 'Obra de verificación'); await page.fill('#ob-ini', '2026-11-02');
  await page.fill('#ob-imp', '30.000'); await page.fill('#ob-jor', '30'); await page.fill('#ob-mat', '8000');
  await page.click('#obra-form button[type="submit"]');
  await page.waitForFunction((c) => document.querySelector('.obra-hero') && document.querySelector('.obra-hero').textContent.includes(c), cod, { timeout: 15000 });
  check('Obras: Dirección abre una obra con código y cuadrilla', /13 nov/.test(await page.textContent('.obra-hero')), 'fin calculado 13 nov (10 días con 2+1)');
  const cajas = page.locator('#parte-form input[name="op"]');
  check('Obras: parte diario con operarios', await cajas.count() >= 3, String(await cajas.count()));
  await cajas.nth(0).check(); await cajas.nth(1).check();
  await page.click('#parte-form button[type="submit"]');
  await page.waitForFunction(() => /2 de 30 jornadas/.test(document.querySelector('.obra-hero').textContent), null, { timeout: 15000 });
  check('Obras: el parte suma avance (2 de 30 jornadas)', true);
  await page.click('[data-obra-tab="pres"]'); await page.fill('#vf-imp', '27.000'); await page.fill('#vf-jor', '27'); await page.fill('#vf-mot', 'Medición real'); await page.click('#version-form button[type="submit"]');
  await page.waitForFunction(() => /mod 1/.test(document.querySelector('.obra-hero').textContent), null, { timeout: 15000 });
  check('Obras: modificación «mod 1» manda y recalcula', /27\.000/.test(await page.textContent('.obra-hero')));
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-obra-mod.png`, fullPage: true });
  await page.click('[data-obra-tab="costes"]'); await page.fill('#co-con', 'Sacos de mortero'); await page.fill('#co-imp', '250'); await page.click('#coste-obra-form button[type="submit"]');
  await page.waitForFunction(() => /Sacos de mortero/.test(document.getElementById('view').textContent), null, { timeout: 15000 });
  check('Obras: factura de material a la obra', true);
  await page.click('[data-obra-tab="cert"]'); await page.fill('#ce-imp', '10.000'); await page.click('#cert-form button[type="submit"]');
  await page.waitForSelector('[data-cert-estado="enviada"]', { timeout: 15000 }); await page.click('[data-cert-estado="enviada"]');
  await page.waitForSelector('.certs li', { timeout: 15000 }); await page.waitForTimeout(400);
  check('Certificación creada y enviada al cliente', /Enviada al cliente/.test(await page.textContent('.certs')));
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-obra-certificacion.png`, fullPage: true });
  // Costes: KPIs, pegar desde Excel e IA
  await page.goto(`${URL0}/#costes`, { waitUntil: 'networkidle' }); await enVivo(page);
  check('Costes: KPIs de indirecto y margen necesario', /Margen directo necesario/i.test(await page.textContent('#view')));
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-costes-resumen.png`, fullPage: true });
  await page.click('[data-costes-tab="ingesta"]');
  await page.fill('#excel-txt', 'Fecha\tConcepto\tProveedor\tImporte\tTipo\tCategoría\tObra\tPeriodicidad\n01/11/2026\tSeguro de convenio\tAseguradora\t900\tindirecto\tseguro\t\tanual\n15/11/2026\tGasolina noviembre\tEstación\t1.240,50\tdirecto\tgasolina\t' + cod + '\tpuntual');
  await page.click('#excel-form button[type="submit"]'); await page.waitForSelector('[data-excel-guardar]');
  check('Excel: 2 filas válidas en la previsualización', (await page.locator('#view tr.err').count()) === 0);
  await page.click('[data-excel-guardar]'); await page.waitForFunction(() => !document.querySelector('[data-excel-guardar]'), null, { timeout: 15000 });
  check('Excel: lote importado', true);
  await page.setInputFiles('#ia-file', { name: 'factura.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 prueba R4') });
  await page.click('#ia-form button[type="submit"]'); await page.waitForSelector('[data-ia-guardar]', { timeout: 20000 });
  check('IA: lee la factura (proveedor y base imponible)', /Morteros Técnicos Baleares/.test(await page.textContent('.ia-previa')));
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-costes-ingesta.png`, fullPage: true });
  await page.click('[data-ia-guardar]'); await page.waitForFunction(() => !document.querySelector('[data-ia-guardar]'), null, { timeout: 15000 });
  // Almacén: salida a obra
  await page.goto(`${URL0}/#almacen`, { waitUntil: 'networkidle' }); await enVivo(page);
  await page.selectOption('#mv-art', { index: 1 }); await page.fill('#mv-can', '2'); await page.selectOption('#mv-obra', { label: cod + ' · Obra de verificación' });
  await page.click('#mov-form button[type="submit"]'); await page.waitForTimeout(800);
  check('Almacén: salida de material a la obra', new RegExp(cod).test(await page.textContent('#view')));
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-almacen.png`, fullPage: true });
  // Presupuesto estándar → aceptar → obra
  await page.goto(`${URL0}/#presupuestos`, { waitUntil: 'networkidle' }); await enVivo(page);
  await page.click('[data-go-pres="nuevo"]'); const codP = 'P' + String(Date.now()).slice(-5);
  await page.fill('#pr-cod', codP); await page.fill('#pr-tit', 'Mecanovigas verificación');
  await page.selectOption('#pr-add', { index: 0 }); await page.click('[data-l-add]');
  await page.fill('[data-l="0"][data-k="cantidad_txt"]', '3x3,20'); await page.fill('[data-l="0"][data-k="precio"]', '95'); await page.fill('#pr-aj', '20');
  check('Presupuesto: 3x3,20 × 95 € +20 % = 1.094,40 €', /1\.?094,40/.test(await page.textContent('#pres-tot')), await page.textContent('#pres-tot'));
  await page.click('#pres-form button[type="submit"]'); await page.waitForSelector('[data-pres-estado="aceptado"]', { timeout: 15000 });
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-presupuesto.png`, fullPage: true });
  await page.click('[data-pres-estado="aceptado"]'); await page.waitForSelector(`[data-go-obra]`, { timeout: 15000 });
  check('Presupuesto aceptado → obra abierta', /Aceptado/.test(await page.textContent('#view')));
  await page.goto(`${URL0}/#planning`, { waitUntil: 'networkidle' }); await enVivo(page);
  check('Planning: barras de obras', await page.locator('.gantt .gb').count() >= 2, String(await page.locator('.gantt .gb').count()));
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-planning.png`, fullPage: true });
  await page.goto(`${URL0}/#mi-jornada`, { waitUntil: 'networkidle' }); await enVivo(page);
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-mi-jornada-direccion.png`, fullPage: true });


  // c) el técnico entra en otro navegador: edita CRM, pero no ve Equipo ni toca ajustes
  const ctxT = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pt = await ctxT.newPage();
  await entrar(pt, nuevo, '#portal-eq'); await enVivo(pt);
  check('Técnico: entra con su rol', /Técnico/.test(await pt.textContent('#who')), await pt.textContent('#who'));
  check('Técnico: «Equipo y accesos» oculto', await pt.locator('#nav [data-id="equipo"]').isHidden());
  const cfg = await pt.evaluate(() => fetch('/api/r4', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'set_config', config: { eco_activo: 'true' } }) }).then((r) => r.status));
  check('Técnico: ajustes bloqueados en el servidor (403)', cfg === 403, String(cfg));
  await pt.goto(`${URL0}/#configuracion`, { waitUntil: 'networkidle' });
  await pt.waitForTimeout(650); await pt.screenshot({ path: `${OUT}/live-tecnico.png`, fullPage: true });

  // d) Dirección retira el acceso → el técnico queda fuera en su siguiente acción
  await page.goto(`${URL0}/#equipo`, { waitUntil: 'networkidle' }); await enVivo(page);
  await page.waitForSelector(`[data-eq="bloquear"][data-email="${nuevo}"]`, { timeout: 15000 });
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
  await pt.waitForTimeout(650); await pt.screenshot({ path: `${OUT}/portal-bloqueado.png` });
  await ctxT.close();
  errors.length = 0; // 401/403 de las pruebas negativas son esperados

  // f) Cliente: pide acceso por 03, Dirección lo aprueba con su ficha y da su conformidad en el portal
  const cli = 'cliente.portal@gmail.example';
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const pc = await ctxC.newPage();
  await entrar(pc, cli, '#portal-cli');
  check('cliente: solicitud pendiente', /Solicitud enviada/.test(await pc.textContent('#portal-msg').catch(() => '')));
  await page.goto(`${URL0}/#equipo`, { waitUntil: 'networkidle' }); await page.reload({ waitUntil: 'networkidle' }); await enVivo(page);
  await page.waitForSelector(`select[data-eq-cli="${cli}"]`, { timeout: 15000 });
  check('Equipo: la solicitud llega marcada como cliente y con su ficha propuesta', /como cliente/.test(await page.textContent('#eq-pend')) && (await page.inputValue(`select[data-eq-cli="${cli}"]`)) !== '');
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-equipo-cliente.png`, fullPage: true });
  await page.click(`[data-eq="aprobar"][data-email="${cli}"]`); await page.waitForTimeout(900);
  await entrar(pc, cli, '#portal-cli'); await pc.waitForSelector('.portal-cli-hola', { timeout: 15000 });
  check('cliente: ve su obra 36 y no la barra de secciones', /Obra 36/.test(await pc.textContent('#view')) && await pc.locator('.side').isHidden());
  const conf = pc.locator('[data-cli-conforme]');
  if (await conf.count()) { await conf.first().click(); await conf.first().click(); await pc.waitForTimeout(900); }
  check('cliente: da su conformidad a la certificación', /Conforme · pendiente de factura/.test(await pc.textContent('#view')));
  await pc.waitForTimeout(650); await pc.screenshot({ path: `${OUT}/live-portal-cliente.png`, fullPage: true });
  const fuga = await pc.evaluate(() => fetch('/api/r4', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'coste_add', tipo: 'indirecto', concepto: 'x', importe: 1 }) }).then((r) => r.status));
  check('cliente: no puede tocar costes (403)', fuga === 403, String(fuga));
  await ctxC.close();
  errors.length = 0;

  // e) móvil (Dirección)
  await page.setViewportSize({ width: 390, height: 844 });
  for (const sec of ['equipo', 'bandeja', 'mi-jornada', 'obras', 'planning', 'costes']) {
    await page.goto(`${URL0}/#${sec}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-movil-${sec}.png`, fullPage: true });
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
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/live-bandeja-detalle.png`, fullPage: true });
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
  await page.waitForTimeout(650); await page.screenshot({ path: `${OUT}/guia-plan.png` });
  await page.click('[data-p="cerrar"]'); await page.click('.g-fab');
  check('guía: se apaga', (await page.getAttribute('.g-fab', 'aria-pressed')) === 'false' && !(await page.$('.g-dock')));
} else check('guía: botón presente', false);

check('sin errores de consola', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
writeFileSync(`${OUT}/verify-report.json`, JSON.stringify({ url: URL0, at: new Date().toISOString(), results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones OK · capturas en ${OUT}/`);
process.exit(failed.length ? 1 : 0);
