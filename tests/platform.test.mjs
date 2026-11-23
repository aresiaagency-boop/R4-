// npm test  ·  pruebas sin red de la capa Vercel y de los flujos generados
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.R4_PANEL_PASSWORD = 'contraseña-de-prueba';
process.env.R4_API_KEY = 'clave-de-prueba-0123456789';
const auth = await import('../lib/auth.js');
const { buildPayload } = await import('../api/r4.js');

test('sesión: firma válida, caducada y manipulada', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const tok = auth.sign(exp);
  assert.equal(auth.verifyToken(tok), true);
  assert.equal(auth.verifyToken(auth.sign(Math.floor(Date.now() / 1000) - 1)), false);
  assert.equal(auth.verifyToken(tok.slice(0, -2) + 'xx'), false);
  assert.equal(auth.verifyToken('basura'), false);
});

test('sesión: cambiar la contraseña invalida las cookies', () => {
  const tok = auth.sign(Math.floor(Date.now() / 1000) + 60);
  process.env.R4_PANEL_PASSWORD = 'otra-contraseña-distinta';
  assert.equal(auth.verifyToken(tok), false);
  process.env.R4_PANEL_PASSWORD = 'contraseña-de-prueba';
  assert.equal(auth.verifyToken(tok), true);
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
});

test('n8n: flujos coherentes (conexiones y credenciales)', () => {
  for (const f of ['R4_setup_db', 'R4_ECO_gmail', 'R4_API']) {
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
