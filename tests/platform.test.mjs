// npm test  ·  pruebas sin red de la capa Vercel y de los flujos generados
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.R4_PANEL_PASSWORD = 'contraseña-de-prueba';
process.env.R4_API_KEY = 'clave-de-prueba-0123456789';
const auth = await import('../lib/auth.js');
const { buildPayload, actorDe } = await import('../api/r4.js');
const r4 = (await import('../api/r4.js')).default;
const callback = (await import('../api/auth/callback.js')).default;
const google = (await import('../api/auth/google.js')).default;

// Respuesta simulada de Vercel (req/res mínimos)
function fakeRes() {
  const h = {}; let body = '';
  return { statusCode: 200, headers: h, setHeader: (k, v) => { h[k.toLowerCase()] = v; }, end: (b) => { body = b || ''; }, get body() { return body; }, json() { return JSON.parse(body); } };
}

const ahora = () => Math.floor(Date.now() / 1000);
const U = { e: 'ana@r4.es', n: 'Ana', r: 'tecnico', v: 'google' };

test('sesión: token firmado con usuario, caducado y manipulado', () => {
  const tok = auth.sign({ ...U, exp: ahora() + 60 });
  assert.equal(auth.verifyToken(tok).e, 'ana@r4.es');
  assert.equal(auth.verifyToken(tok).r, 'tecnico');
  assert.equal(auth.verifyToken(auth.sign({ ...U, exp: ahora() - 1 })), null);
  assert.equal(auth.verifyToken(tok.slice(0, -2) + 'xx'), null);
  // cambiar el rol dentro del token rompe la firma
  const [body, firma] = tok.split('.');
  const falso = Buffer.from(JSON.stringify({ ...U, r: 'direccion', exp: ahora() + 60 })).toString('base64url');
  assert.equal(auth.verifyToken(falso + '.' + firma), null);
  assert.ok(body.length > 10);
  assert.equal(auth.verifyToken('basura'), null);
});

test('sesión: rotar R4_API_KEY o la contraseña invalida las cookies', () => {
  const tok = auth.sign({ ...U, exp: ahora() + 60 });
  process.env.R4_PANEL_PASSWORD = 'otra-contraseña-distinta';
  assert.equal(auth.verifyToken(tok), null);
  process.env.R4_PANEL_PASSWORD = 'contraseña-de-prueba';
  assert.ok(auth.verifyToken(tok));
});

test('Dirección: lista de cuentas de R4_DIRECCION_EMAILS', () => {
  process.env.R4_DIRECCION_EMAILS = ' Direccion@R4.es, otra@r4.es ,';
  assert.deepEqual(auth.direccionEmails(), ['direccion@r4.es', 'otra@r4.es']);
});

test('CSRF: mismo origen', () => {
  assert.equal(auth.sameOrigin({ headers: { host: 'r4.vercel.app', origin: 'https://r4.vercel.app' } }), true);
  assert.equal(auth.sameOrigin({ headers: { host: 'r4.vercel.app', origin: 'https://malo.example' } }), false);
  assert.equal(auth.sameOrigin({ headers: { host: 'r4.vercel.app' } }), true);
});

test('API: lista blanca de operaciones y saneado', () => {
  assert.deepEqual(buildPayload({ op: 'summary' }), { payload: { op: 'summary' } });
  assert.ok(buildPayload({ op: 'DROP TABLE' }).error);
  assert.ok(buildPayload({ op: 'reenviar_wa', id: 'abc' }).error);
  assert.ok(buildPayload({ op: 'set_etapa', id: 3, etapa: 'inventada' }).error);
  const p = buildPayload({ op: 'set_config', config: { evolution_url: 'https://evo.example', apikey: 'NO-DEBE-PASAR', wa_campos: 'nombre' } }).payload;
  assert.equal(p.config.apikey, undefined);
  assert.equal(p.config.evolution_url, 'https://evo.example');
  assert.ok(buildPayload({ op: 'set_config', config: { evolution_url: 'javascript:alert(1)' } }).error);
  const u = buildPayload({ op: 'update_extraccion', id: 7, extraccion: { nombre: 'Ana', es_cliente: true, raro: 'x' } }).payload;
  assert.deepEqual(u.extraccion, { nombre: 'Ana' });
  assert.equal(buildPayload({ op: 'set_etapa', id: 2, etapa: 'perdido', motivo: 'Precio' }).payload.motivo, 'Precio');
  assert.ok(buildPayload({ op: 'update_inmueble', id: 4, anio_construccion: '68' }).error);
  assert.ok(buildPayload({ op: 'update_inmueble', id: 4, iee_fecha: '01/02/2020' }).error);
  assert.deepEqual(buildPayload({ op: 'update_inmueble', id: 4, anio_construccion: '1968', iee_fecha: '2017-05-02', tipo_estructura: 'Viguetas' }).payload,
    { op: 'update_inmueble', id: 4, anio_construccion: '1968', iee_fecha: '2017-05-02', tipo_estructura: 'Viguetas' });
  assert.deepEqual(buildPayload({ op: 'usuario_set', email: ' Luis@R4.es ', rol: 'comercial', estado: 'activo' }).payload,
    { op: 'usuario_set', email: 'luis@r4.es', rol: 'comercial', estado: 'activo' });
  assert.ok(buildPayload({ op: 'usuario_set', email: 'luis@r4.es', rol: 'superadmin' }).error);
  assert.ok(buildPayload({ op: 'usuario_set', email: 'no-es-email', estado: 'activo' }).error);
  assert.ok(buildPayload({ op: 'usuario_set', email: 'luis@r4.es' }).error);
  assert.ok(buildPayload({ op: 'auth_login', email: 'x@y.z', direccion: true }).error, 'auth_login no se puede llamar desde el navegador');
});

test('API: el actor sale de la sesión firmada, nunca del cuerpo', async () => {
  assert.deepEqual(actorDe({ e: 'ana@r4.es', r: 'tecnico', v: 'google' }), { email: 'ana@r4.es', rol: 'tecnico', via: 'google' });
  assert.deepEqual(actorDe({ e: 'direccion', r: 'direccion', v: 'password' }), { email: '', rol: 'direccion', via: 'password' });
  const enviados = [];
  globalThis.fetch = async (url, o) => { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 }); };
  const res = fakeRes();
  await r4({ method: 'POST', headers: { host: 'r4.test', cookie: 'r4_session=' + encodeURIComponent(auth.sign({ ...U, exp: ahora() + 60 })) },
    body: { op: 'set_etapa', id: 3, etapa: 'visita', actor: { email: 'jefe@r4.es', via: 'password' } } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(enviados[0].actor, { email: 'ana@r4.es', rol: 'tecnico', via: 'google' });
});

test('API: si Dirección retira el acceso, la sesión se cierra (401 + cookie borrada)', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, auth: false, error: 'acceso pendiente o retirado por Dirección' }), { status: 200 });
  const res = fakeRes();
  await r4({ method: 'GET', url: '/api/r4?op=summary', query: { op: 'summary' }, headers: { host: 'r4.test', cookie: 'r4_session=' + encodeURIComponent(auth.sign({ ...U, exp: ahora() + 60 })) } }, res);
  assert.equal(res.statusCode, 401);
  assert.match(res.headers['set-cookie'], /r4_session=;.*Max-Age=0/);
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, forbidden: true, error: 'tu rol es de solo lectura' }), { status: 200 });
  const res2 = fakeRes();
  await r4({ method: 'POST', headers: { host: 'r4.test', cookie: 'r4_session=' + encodeURIComponent(auth.sign({ ...U, exp: ahora() + 60 })) }, body: { op: 'reenviar_wa', id: 1 } }, res2);
  assert.equal(res2.statusCode, 403);
});

test('Google OAuth: redirección con state y callback que abre sesión solo si Dirección aprobó', async () => {
  process.env.GOOGLE_CLIENT_ID = 'cliente-prueba.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'secreto-prueba';
  process.env.R4_DIRECCION_EMAILS = 'jefe@r4.es';
  const r1 = fakeRes();
  google({ url: '/api/auth/google?tipo=cliente', headers: { host: 'r4.test', 'x-forwarded-proto': 'https' } }, r1);
  assert.equal(r1.statusCode, 302);
  const loc = new URL(r1.headers.location);
  assert.equal(loc.host, 'accounts.google.com');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://r4.test/api/auth/callback');
  assert.equal(loc.searchParams.get('scope'), 'openid email profile');
  const state = loc.searchParams.get('state');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  const cookieState = String(r1.headers['set-cookie']).match(/r4_oauth_state=([^;]+)/)[1];
  const [st0, verifier, tipoSol] = cookieState.split('.');
  assert.equal(tipoSol, 'cliente', 'la puerta del portal viaja en el state');
  assert.equal(st0, state);
  assert.equal(auth.challengeDe(verifier), loc.searchParams.get('code_challenge'), 'PKCE S256');

  // state distinto → error, sin llamar a Google
  const r2 = fakeRes();
  await callback({ url: '/api/auth/callback?code=c&state=otro', headers: { host: 'r4.test', 'x-forwarded-proto': 'https', cookie: 'r4_oauth_state=' + cookieState } }, r2);
  assert.equal(r2.headers.location, 'https://r4.test/?acceso=error');

  const simula = (email, estado, rol, aud = process.env.GOOGLE_CLIENT_ID, emailBD) => {
    const llamadas = [];
    globalThis.fetch = async (url, o) => {
      url = String(url); llamadas.push(url);
      if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) return new Response(JSON.stringify({ aud, iss: 'https://accounts.google.com', email, email_verified: 'true', name: 'Nombre', exp: String(ahora() + 300) }));
      if (url.startsWith('https://oauth2.googleapis.com/token')) { assert.equal(new URLSearchParams(String(o.body)).get('code_verifier'), verifier); return new Response(JSON.stringify({ id_token: 'idt' })); }
      const b = JSON.parse(o.body); llamadas.push(b);
      return new Response(JSON.stringify({ ok: true, email: emailBD || b.email, nombre: 'Nombre', rol, estado }));
    };
    return llamadas;
  };
  const req = { url: '/api/auth/callback?code=c&state=' + state, headers: { host: 'r4.test', 'x-forwarded-proto': 'https', cookie: 'r4_oauth_state=' + cookieState } };

  let ll = simula('nuevo@gmail.com', 'pendiente', 'pendiente'); let r = fakeRes(); await callback(req, r);
  assert.equal(r.headers.location, 'https://r4.test/?acceso=pendiente');
  assert.equal(ll.find((x) => typeof x === 'object').direccion, false);
  assert.equal(ll.find((x) => typeof x === 'object').solicitud, 'cliente');
  assert.ok(!String(r.headers['set-cookie']).includes('r4_session=ey'));

  ll = simula('jefe@r4.es', 'activo', 'direccion'); r = fakeRes(); await callback(req, r);
  assert.equal(ll.find((x) => typeof x === 'object').direccion, true, 'R4_DIRECCION_EMAILS marca Dirección');
  assert.equal(r.headers.location, 'https://r4.test/#mission-control');
  const cookie = r.headers['set-cookie'].find((c) => c.startsWith('r4_session='));
  const sesion = auth.verifyToken(decodeURIComponent(cookie.split(';')[0].slice('r4_session='.length)));
  assert.deepEqual([sesion.e, sesion.r, sesion.v], ['jefe@r4.es', 'direccion', 'google']);

  simula('bloq@gmail.com', 'bloqueado', 'tecnico'); r = fakeRes(); await callback(req, r);
  assert.equal(r.headers.location, 'https://r4.test/?acceso=bloqueado');

  simula('jefe@r4.es', 'activo', 'direccion', 'otro-cliente'); r = fakeRes(); await callback(req, r);
  assert.equal(r.headers.location, 'https://r4.test/?acceso=error', 'token emitido para otra app');

  simula('jefe@r4.es', 'activo', 'direccion', undefined, 'otro@r4.es'); r = fakeRes(); await callback(req, r);
  assert.equal(r.headers.location, 'https://r4.test/?acceso=error', 'la BD devuelve otro email');
});

test('sesión: R4_SESSION_SECRET separa la firma de R4_API_KEY', () => {
  const tok = auth.sign({ ...U, exp: ahora() + 60 });
  process.env.R4_SESSION_SECRET = 'x'.repeat(40);
  assert.equal(auth.verifyToken(tok), null, 'con secreto propio, los tokens anteriores dejan de valer');
  const tok2 = auth.sign({ ...U, exp: ahora() + 60 });
  process.env.R4_API_KEY = 'otra-clave-de-prueba-9876543210';
  assert.ok(auth.verifyToken(tok2), 'rotar R4_API_KEY no afecta si hay R4_SESSION_SECRET');
  delete process.env.R4_SESSION_SECRET; process.env.R4_API_KEY = 'clave-de-prueba-0123456789';
});

test('API: GET solo permite summary', async () => {
  const enviados = [];
  globalThis.fetch = async (url, o) => { enviados.push(JSON.parse(o.body)); return new Response(JSON.stringify({ ok: true, data: {} })); };
  const res = fakeRes();
  await r4({ method: 'GET', url: '/api/r4?op=set_config', query: { op: 'set_config' }, headers: { host: 'r4.test', cookie: 'r4_session=' + encodeURIComponent(auth.sign({ ...U, exp: ahora() + 60 })) } }, res);
  assert.equal(enviados[0].op, 'summary');
});

test('n8n: flujos coherentes (conexiones y credenciales)', () => {
  for (const f of ['R4_setup_db', 'R4_ECO_gmail', 'R4_API', 'R4_documentos']) {
    const wf = JSON.parse(readFileSync(new URL(`../n8n/${f}.json`, import.meta.url), 'utf8'));
    const names = new Set(wf.nodes.map((n) => n.name));
    assert.equal(names.size, wf.nodes.length, `${f}: nombres de nodo duplicados`);
    for (const [from, c] of Object.entries(wf.connections)) {
      assert.ok(names.has(from), `${f}: origen inexistente ${from}`);
      for (const out of c.main) for (const l of out) assert.ok(names.has(l.node), `${f}: destino inexistente ${l.node}`);
    }
    for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.postgres')) assert.ok(n.credentials && n.credentials.postgres, `${f}: ${n.name} sin credencial Postgres`);
  }
});

test('schema.sql: sin parámetros posicionales (pg-promise en n8n)', () => {
  const s = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  assert.equal(/\$\d/.test(s), false);
});

test('Gestión: validación de obras, partes, costes (lote Excel), almacén y presupuestos', async () => {
  const { numES } = await import('../lib/gestion.js');
  assert.deepEqual(['48.000', '48.000,50', '12,5', '1200'].map(numES), [48000, 48000.5, 12.5, 1200]);
  assert.ok(buildPayload({ op: 'obra_set', titulo: 'Sin código' }).error, 'obra nueva sin código');
  assert.ok(buildPayload({ op: 'obra_set', codigo: '36', titulo: 'x', presupuesto_url: 'javascript:alert(1)' }).error);
  assert.ok(buildPayload({ op: 'obra_set', codigo: '36<script>', titulo: 'x' }).error);
  const ob = buildPayload({ op: 'obra_set', codigo: '36', titulo: 'Mecanovigas', importe: '48.000', jornadas: 30, actor: { email: 'malo' }, otro: 1 }).payload;
  assert.deepEqual(ob, { op: 'obra_set', codigo: '36', titulo: 'Mecanovigas', importe: '48000', jornadas: '30' });
  assert.ok(buildPayload({ op: 'parte_set', obra_id: 1, fecha: '24/11/2026', operarios: [] }).error);
  assert.ok(buildPayload({ op: 'parte_set', obra_id: 1, fecha: '2026-11-24', operarios: [{ id: 1, jornadas: '7' }] }).error);
  const lote = buildPayload({ op: 'coste_add', costes: Array.from({ length: 3 }, (_, i) => ({ tipo: 'indirecto', categoria: 'seguro', concepto: 'Seguro ' + i, importe: '1.200', origen: 'excel' })) }).payload;
  assert.equal(lote.costes.length, 3); assert.equal(lote.costes[0].importe, '1200');
  assert.ok(buildPayload({ op: 'coste_add', costes: [{ tipo: 'directo', concepto: 'x', importe: 'abc' }] }).error);
  assert.ok(buildPayload({ op: 'coste_add', costes: Array.from({ length: 301 }, () => ({ tipo: 'directo', concepto: 'x', importe: 1 })) }).error);
  assert.ok(buildPayload({ op: 'movimiento_add', articulo_id: 1, tipo: 'salida', cantidad: 3 }).error, 'salida sin obra');
  assert.ok(buildPayload({ op: 'cert_estado', id: 1, estado: 'pagada' }).error);
  const pr = buildPayload({ op: 'presupuesto_set', codigo: '37', titulo: 'Mecanovigas', ajuste_pct: '20', lineas: [{ descripcion: 'Mecanoviga', cantidad: '9,6', precio: 100 }] }).payload;
  assert.equal(pr.lineas[0].cantidad, '9.6');
  assert.ok(buildPayload({ op: 'presupuesto_set', codigo: '37', titulo: 'x', ajuste_pct: '900' }).error);
  assert.deepEqual(buildPayload({ op: 'usuario_set', email: 'c@r4.es', rol: 'cliente', estado: 'activo', cliente_id: 7 }).payload,
    { op: 'usuario_set', email: 'c@r4.es', rol: 'cliente', estado: 'activo', cliente_id: 7 });
});

test('/api/doc: comprueba el rol vigente en la BD antes de leer y sanea la respuesta', async () => {
  const doc = (await import('../api/doc.js')).default;
  const cookie = 'r4_session=' + encodeURIComponent(auth.sign({ e: 'enc@r4.es', n: 'Enc', r: 'encargado', v: 'google', exp: ahora() + 60 }));
  const llamadas = [];
  globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body); llamadas.push(b.op || 'doc');
    if (b.op === 'doc_permiso') return new Response(JSON.stringify({ ok: true, rol: 'encargado' }));
    return new Response(JSON.stringify({ ok: true, documento: { proveedor: 'Prov <b>', fecha: '2026-02-30x', total: '12.5', tipo_coste: 'raro', lineas: [{ concepto: 'a', importe: 3 }] } }));
  };
  const res = fakeRes();
  await doc({ method: 'POST', headers: { host: 'r4.test', cookie }, body: { nombre: 'f.pdf', tipo: 'application/pdf', datos: 'JVBERi0xLjQ=' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(llamadas, ['doc_permiso', 'doc']);
  const d = res.json().documento;
  assert.equal(d.fecha, ''); assert.equal(d.tipo_coste, 'directo'); assert.equal(d.total, 12.5);
  globalThis.fetch = async (url, o) => new Response(JSON.stringify({ ok: false, auth: false, error: 'acceso pendiente o retirado por Dirección' }));
  const r2 = fakeRes();
  await doc({ method: 'POST', headers: { host: 'r4.test', cookie }, body: { nombre: 'f.pdf', tipo: 'application/pdf', datos: 'JVBERi0xLjQ=' } }, r2);
  assert.equal(r2.statusCode, 401, 'bloqueado en la BD → fuera aunque la cookie diga encargado');
  const r3 = fakeRes();
  await doc({ method: 'POST', headers: { host: 'r4.test', cookie }, body: { nombre: 'x.exe', tipo: 'application/x-msdownload', datos: 'AAAA' } }, r3);
  assert.equal(r3.statusCode, 400);
});

test('Gestión: fechas imposibles, enteros y duplicados', () => {
  assert.ok(buildPayload({ op: 'parte_set', obra_id: 1, fecha: '2026-02-30', operarios: [] }).error);
  assert.ok(buildPayload({ op: 'obra_set', id: 1, oficiales: '2.5' }).error);
  assert.ok(buildPayload({ op: 'obra_version', obra_id: 1, linea: '1e10', importe: 1 }).error);
  assert.ok(buildPayload({ op: 'coste_del', id: 1e20 }).error);
  assert.equal(buildPayload({ op: 'parte_set', obra_id: 1, fecha: '2026-11-24', operarios: [{ id: 3 }, { id: 3 }] }).payload.operarios.length, 1);
});
