// Genera los flujos de n8n de R4 a partir de las fuentes del repo:
//   db/schema.sql + n8n/eco-prompt.mjs  →  n8n/R4_setup_db.json, n8n/R4_ECO_gmail.json, n8n/R4_API.json
// Uso: npm run build:n8n
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ecoRequestBody, ECO_VERSION } from '../n8n/eco-prompt.mjs';
import { DOC_PROMPT, DOC_SCHEMA, DOC_VERSION } from '../n8n/doc-prompt.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (f, wf) => { writeFileSync(join(root, 'n8n', f), JSON.stringify(wf, null, 2) + '\n'); console.log('✓ n8n/' + f, `(${wf.nodes.length} nodos)`); };
const uid = (s) => { const h = createHash('sha1').update('r4:' + s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

// Credenciales que YA existen en r4-n8n (ids leídos de la instancia el 23 nov 2026)
const CRED = {
  postgres: { postgres: { id: 'Zcr7iqVn6j1Z7UAb', name: 'Postgres account' } },
  openai: { openAiApi: { id: 'ibzYsjSd50fbsD3I', name: 'OpenAI account' } },
  r4key: { httpHeaderAuth: { id: 'kgItKJrwVQyHIxOP', name: 'R4 API key' } }
};

const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ id: uid(name), name, type, typeVersion, position, parameters, ...extra });
const pgFn = (name, pos, fn, exprJson, extra = {}) => node(name, 'n8n-nodes-base.postgres', 2.5, pos, {
  operation: 'executeQuery',
  query: `SELECT ${fn}($1::jsonb) AS r`,
  options: { queryReplacement: `={{ JSON.stringify(${exprJson}) }}` }
}, { credentials: CRED.postgres, ...extra });
const ifTrue = (name, pos, expr) => node(name, 'n8n-nodes-base.if', 2.2, pos, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: uid(name + ':c'), leftValue: `={{ ${expr} }}`, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and'
  },
  options: {}
});
const link = (pairs) => {
  const c = {};
  for (const [from, to, outIdx = 0] of pairs) {
    c[from] ??= { main: [] };
    while (c[from].main.length <= outIdx) c[from].main.push([]);
    c[from].main[outIdx].push({ node: to, type: 'main', index: 0 });
  }
  return c;
};
const settings = { executionOrder: 'v1', saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all', saveManualExecutions: true, timezone: 'Europe/Madrid' };

// Código compartido: compone el aviso de WhatsApp desde la salida de r4_aplicar_extraccion / r4_api
const COMPONER_WA = `// Construye un aviso por cada número de destino configurado en r4_config.wa_destino_direccion
const etiquetas = { nombre: 'Nombre', empresa: 'Empresa', email: 'Email', telefono: 'Teléfono', servicio: 'Servicio', urgencia: 'Urgencia', solicita: 'Solicita', tipo_cliente: 'Tipo', direccion_obra: 'Dirección de la obra', municipio: 'Municipio', titulo: 'Asunto', resumen: 'Resumen' };
const out = [];
for (const it of $input.all()) {
  const r = it.json.r || {};
  const x = r.extraccion || {};
  const wa = r.wa || {};
  const campos = String(wa.campos || 'nombre,empresa,email,telefono,servicio,urgencia,resumen').split(',').map(s => s.trim()).filter(Boolean);
  const lineas = ['*NUEVO ' + (r.canal === 'whatsapp' ? 'WHATSAPP' : 'CORREO') + ' DE CLIENTE · R4*' + (x.urgencia === 'alta' ? ' 🔴 URGENTE' : '')];
  for (const c of campos) {
    const v = x[c];
    if (v !== undefined && v !== null && String(v).trim() !== '') lineas.push('*' + (etiquetas[c] || c) + ':* ' + String(v).trim());
  }
  if (wa.ficha) lineas.push('*Ficha:* ' + wa.ficha);
  lineas.push('_Mensaje #' + r.id + ' · oportunidad #' + r.oportunidad_id + '_');
  const destinos = String(wa.destino || '').split(',').map(s => s.replace(/[^0-9]/g, '')).filter(Boolean);
  for (const number of destinos) {
    out.push({ json: { id: r.id, url: String(wa.url || '').replace(/\\/+$/, ''), instancia: wa.instancia, number, text: lineas.join('\\n') } });
  }
}
return out;`;

const evolutionSend = (name, pos) => node(name, 'n8n-nodes-base.httpRequest', 4.2, pos, {
  method: 'POST',
  url: '={{ $json.url }}/message/sendText/{{ encodeURIComponent($json.instancia) }}',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify({ number: $json.number, text: $json.text }) }}',
  options: { timeout: 20000 }
}, { onError: 'continueErrorOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 3000, notes: 'Credencial Header Auth «Evolution API R4»: Name = apikey · Value = apikey de la instancia' });

// ---------------------------------------------------------------- 1) Setup DB
const schema = readFileSync(join(root, 'db/schema.sql'), 'utf8');
if (/\$\d/.test(schema)) throw new Error('schema.sql contiene un parámetro posicional (dólar+número): pg-promise fallaría en n8n');
out('R4_setup_db.json', {
  name: 'R4 · Setup DB (esquema v1)',
  nodes: [
    node('Ejecutar a mano', 'n8n-nodes-base.manualTrigger', 1, [0, 0], {}),
    node('Instalar esquema R4', 'n8n-nodes-base.postgres', 2.5, [260, 0], { operation: 'executeQuery', query: schema, options: {} }, { credentials: CRED.postgres, notes: 'Idempotente. Generado desde db/schema.sql' })
  ],
  connections: link([['Ejecutar a mano', 'Instalar esquema R4']]),
  settings,
  pinData: {}
});

// ---------------------------------------------------------------- 2) ECO · Gmail
const NORMALIZAR = `// Normaliza el correo de Gmail (modo no simplificado) al formato de r4_ingest
const out = [];
for (const item of $input.all()) {
  const j = item.json;
  const fromObj = (j.from && j.from.value && j.from.value[0]) || {};
  const fromText = typeof j.from === 'string' ? j.from : ((j.from && j.from.text) || '');
  const email = fromObj.address || (fromText.match(/<([^>]+)>/) || [])[1] || (fromText.match(/[\\w.+-]+@[\\w.-]+/) || [])[0] || '';
  const nombre = (fromObj.name || fromText.replace(/<[^>]+>/, '')).replace(/"/g, '').trim();
  let texto = j.text || '';
  if (!texto && j.html) texto = String(j.html).replace(/<style[\\s\\S]*?<\\/style>/gi, '').replace(/<br\\s*\\/?>/gi, '\\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  texto = String(texto).replace(/\\r/g, '').replace(/[ \\t]+/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
  const corte = texto.search(/\\n(El .{5,90} escribió:|On .{5,90} wrote:|-{3,} ?Mensaje original|-{3,} ?Original Message|De: .+\\n(Enviado|Fecha):)/);
  if (corte > 200) texto = texto.slice(0, corte).trim();
  out.push({ json: {
    canal: 'gmail',
    external_id: j.id,
    thread_id: j.threadId || '',
    remitente_nombre: nombre,
    remitente_email: String(email).toLowerCase(),
    asunto: j.subject || '(sin asunto)',
    cuerpo: texto.slice(0, 12000),
    adjuntos: item.binary ? Object.keys(item.binary).length : (Array.isArray(j.attachments) ? j.attachments.length : 0),
    recibido_at: j.date ? new Date(j.date).toISOString() : new Date().toISOString()
  } });
}
return out;`;

const PREPARAR = `// Petición a OpenAI con salida JSON estricta (esquema ECO ${ECO_VERSION}, ver n8n/eco-prompt.mjs)
const base = ${JSON.stringify(ecoRequestBody({ remitente_nombre: '__N__', remitente_email: '__E__', asunto: '__A__', cuerpo: '__C__', adjuntos: 0 }), null, 2)};
return $input.all().map((it) => {
  const m = it.json.r.msg;
  const body = JSON.parse(JSON.stringify(base));
  body.messages[1].content = 'REMITENTE: ' + m.remitente_nombre + ' <' + m.remitente_email + '>\\nASUNTO: ' + m.asunto + '\\nADJUNTOS: ' + m.adjuntos + '\\n--- CUERPO DEL CORREO ---\\n' + String(m.cuerpo).slice(0, 8000) + '\\n--- FIN ---';
  return { json: { id: it.json.r.id, body } };
});`;

const LEER = `// Lee la respuesta del modelo; si no es JSON válido, deja el mensaje para revisión manual
return $input.all().map((it, i) => {
  const id = $('Preparar petición IA').itemMatching(i).json.id;
  let x;
  try {
    x = JSON.parse(it.json.choices[0].message.content);
  } catch (e) {
    x = { es_cliente: true, motivo: 'ECO no pudo leer la respuesta de la IA: revisar a mano', nombre: '', empresa: '', email: '', telefono: '', tipo_cliente: 'desconocido', servicio: 'Otro', solicita: 'otro', urgencia: 'media', direccion_obra: '', municipio: '', titulo: '', resumen: 'Revisar a mano: la extracción automática falló.' };
  }
  x.modelo = it.json.model || '';
  x.eco = '${ECO_VERSION}';
  return { json: { id, extraccion: x } };
});`;

out('R4_ECO_gmail.json', {
  name: 'R4 · ECO · Gmail → extracción → Postgres → WhatsApp',
  nodes: [
    node('Gmail · correo nuevo', 'n8n-nodes-base.gmailTrigger', 1.2, [0, 0], {
      pollTimes: { item: [{ mode: 'everyMinute' }] },
      simple: false,
      filters: { includeSpamTrash: false, labelIds: ['INBOX'] },
      options: {}
    }, { notes: 'Conectar aquí la credencial Gmail OAuth2 de la cuenta nueva de R4' }),
    node('Normalizar correo', 'n8n-nodes-base.code', 2, [220, 0], { jsCode: NORMALIZAR }),
    pgFn('Registrar mensaje', [440, 0], 'r4_ingest', '$json'),
    ifTrue('¿Mensaje nuevo?', [660, 0], '$json.r.nuevo'),
    node('Preparar petición IA', 'n8n-nodes-base.code', 2, [880, -20], { jsCode: PREPARAR }),
    node('ECO · extraer datos (OpenAI)', 'n8n-nodes-base.httpRequest', 4.2, [1100, -20], {
      method: 'POST',
      url: 'https://api.openai.com/v1/chat/completions',
      authentication: 'predefinedCredentialType',
      nodeCredentialType: 'openAiApi',
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ JSON.stringify($json.body) }}',
      options: { timeout: 60000 }
    }, { credentials: CRED.openai, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 }),
    node('Leer extracción', 'n8n-nodes-base.code', 2, [1320, -20], { jsCode: LEER }),
    pgFn('Aplicar extracción', [1540, -20], 'r4_aplicar_extraccion', '$json'),
    ifTrue('¿Avisar por WhatsApp?', [1760, -20], '$json.r.es_cliente === true && $json.r.wa && $json.r.wa.activo === true'),
    node('Componer WhatsApp', 'n8n-nodes-base.code', 2, [1980, -40], { jsCode: COMPONER_WA }),
    evolutionSend('Evolution · enviar aviso', [2200, -40]),
    pgFn('Marcar WA enviado', [2420, -120], 'r4_marcar_wa', "{ id: $('Componer WhatsApp').item.json.id, ok: true }"),
    pgFn('Marcar WA fallido', [2420, 60], 'r4_marcar_wa', "{ id: $('Componer WhatsApp').item.json.id, ok: false, detalle: ($json.error && ($json.error.message || $json.error.description)) || JSON.stringify($json).slice(0, 300) }"),
    node('Duplicado: no hacer nada', 'n8n-nodes-base.noOp', 1, [880, 160], {}),
    node('Sin aviso (no cliente o WA sin configurar)', 'n8n-nodes-base.noOp', 1, [1980, 140], {})
  ],
  connections: link([
    ['Gmail · correo nuevo', 'Normalizar correo'],
    ['Normalizar correo', 'Registrar mensaje'],
    ['Registrar mensaje', '¿Mensaje nuevo?'],
    ['¿Mensaje nuevo?', 'Preparar petición IA', 0],
    ['¿Mensaje nuevo?', 'Duplicado: no hacer nada', 1],
    ['Preparar petición IA', 'ECO · extraer datos (OpenAI)'],
    ['ECO · extraer datos (OpenAI)', 'Leer extracción'],
    ['Leer extracción', 'Aplicar extracción'],
    ['Aplicar extracción', '¿Avisar por WhatsApp?'],
    ['¿Avisar por WhatsApp?', 'Componer WhatsApp', 0],
    ['¿Avisar por WhatsApp?', 'Sin aviso (no cliente o WA sin configurar)', 1],
    ['Componer WhatsApp', 'Evolution · enviar aviso'],
    ['Evolution · enviar aviso', 'Marcar WA enviado', 0],
    ['Evolution · enviar aviso', 'Marcar WA fallido', 1]
  ]),
  settings,
  pinData: {}
});

// ---------------------------------------------------------------- 3) API para la plataforma
const respond = (name, pos, expr) => node(name, 'n8n-nodes-base.respondToWebhook', 1.1, pos, {
  respondWith: 'json',
  responseBody: `={{ JSON.stringify(${expr}) }}`,
  options: { responseCode: 200 }
});
out('R4_API.json', {
  name: 'R4 · API de la plataforma (Vercel → Postgres)',
  nodes: [
    node('POST /webhook/r4-api', 'n8n-nodes-base.webhook', 2, [0, 0], {
      httpMethod: 'POST',
      path: 'r4-api',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      options: {}
    }, { webhookId: uid('webhook:r4-api'), notes: 'Credencial Header Auth «R4 API key»: Name = x-r4-key · Value = el mismo valor que R4_API_KEY en Vercel' }),
    pgFn('r4_api', [240, 0], 'r4_api', '$json.body || {}'),
    ifTrue('¿Enviar WhatsApp?', [480, 0], '$json.r.enviar_wa === true'),
    node('Componer WhatsApp', 'n8n-nodes-base.code', 2, [720, -100], { jsCode: COMPONER_WA }),
    evolutionSend('Evolution · enviar aviso', [940, -100]),
    pgFn('Marcar WA enviado', [1160, -180], 'r4_marcar_wa', "{ id: $('Componer WhatsApp').item.json.id, ok: true }"),
    pgFn('Marcar WA fallido', [1160, -20], 'r4_marcar_wa', "{ id: $('Componer WhatsApp').item.json.id, ok: false, detalle: ($json.error && ($json.error.message || $json.error.description)) || JSON.stringify($json).slice(0, 300) }"),
    respond('Responder (WA enviado)', [1380, -180], "Object.assign({}, $('r4_api').first().json.r, { wa_enviado: true })"),
    respond('Responder (WA fallido)', [1380, -20], "Object.assign({}, $('r4_api').first().json.r, { wa_enviado: false, wa_error: $json.r && $json.r.ok ? 'envío fallido' : 'error' })"),
    respond('Responder', [720, 120], '$json.r')
  ],
  connections: link([
    ['POST /webhook/r4-api', 'r4_api'],
    ['r4_api', '¿Enviar WhatsApp?'],
    ['¿Enviar WhatsApp?', 'Componer WhatsApp', 0],
    ['¿Enviar WhatsApp?', 'Responder', 1],
    ['Componer WhatsApp', 'Evolution · enviar aviso'],
    ['Evolution · enviar aviso', 'Marcar WA enviado', 0],
    ['Evolution · enviar aviso', 'Marcar WA fallido', 1],
    ['Marcar WA enviado', 'Responder (WA enviado)'],
    ['Marcar WA fallido', 'Responder (WA fallido)']
  ]),
  settings,
  pinData: {}
});

// ---------------------------------------------------------------- 4) Documentos IA (facturas en PDF o foto → datos de coste)
const DOC_PREPARAR = `// Petición a OpenAI con el documento (PDF como archivo, foto como imagen) · ${DOC_VERSION}
const b = $json.body || {};
const tipo = String(b.tipo || '');
const datos = String(b.datos || '');
if (!datos || datos.length > 4500000 || !/^[A-Za-z0-9+/=]+$/.test(datos) || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(tipo)) {
  return [{ json: { invalido: true } }];
}
const contenido = tipo === 'application/pdf'
  ? { type: 'file', file: { filename: String(b.nombre || 'documento.pdf').slice(0, 100), file_data: 'data:application/pdf;base64,' + datos } }
  : { type: 'image_url', image_url: { url: 'data:' + tipo + ';base64,' + datos, detail: 'high' } };
return [{ json: { body: {
  model: 'gpt-4o-mini', temperature: 0,
  response_format: { type: 'json_schema', json_schema: { name: 'documento_r4', strict: true, schema: ${JSON.stringify(DOC_SCHEMA)} } },
  messages: [
    { role: 'system', content: ${JSON.stringify(DOC_PROMPT)} },
    { role: 'user', content: [{ type: 'text', text: 'Extrae los datos de este documento.' }, contenido] }
  ]
} } }];`;
const DOC_LEER = `const r = $json;
if (r.invalido) return [{ json: { ok: false, error: 'archivo no válido (PDF, JPG, PNG o WEBP de hasta 3 MB)' } }];
try {
  const doc = JSON.parse(r.choices[0].message.content);
  return [{ json: { ok: true, version: '${DOC_VERSION}', documento: doc } }];
} catch (e) {
  return [{ json: { ok: false, error: 'la IA no pudo leer el documento', detalle: String((r.error && r.error.message) || e.message || '').slice(0, 200) } }];
}`;
out('R4_documentos.json', {
  name: 'R4 · Documentos IA (facturas PDF/foto → costes)',
  nodes: [
    node('POST /webhook/r4-doc', 'n8n-nodes-base.webhook', 2, [0, 0], {
      httpMethod: 'POST', path: 'r4-doc', authentication: 'headerAuth', responseMode: 'responseNode', options: { rawBody: false }
    }, { webhookId: uid('webhook:r4-doc'), credentials: CRED.r4key, notes: 'Misma credencial «R4 API key» que «R4 · API». Solo la llama Vercel (/api/doc).' }),
    node('Preparar petición IA', 'n8n-nodes-base.code', 2, [240, 0], { jsCode: DOC_PREPARAR }),
    ifTrue('¿Archivo válido?', [460, 0], '!$json.invalido'),
    node('Leer documento (OpenAI)', 'n8n-nodes-base.httpRequest', 4.2, [680, -80], {
      method: 'POST', url: 'https://api.openai.com/v1/chat/completions', authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}', options: { timeout: 55000 }
    }, { credentials: CRED.openai, onError: 'continueRegularOutput' }),
    node('Leer resultado', 'n8n-nodes-base.code', 2, [900, 0], { jsCode: DOC_LEER }),
    respond('Responder', [1120, 0], '$json')
  ],
  connections: link([
    ['POST /webhook/r4-doc', 'Preparar petición IA'],
    ['Preparar petición IA', '¿Archivo válido?'],
    ['¿Archivo válido?', 'Leer documento (OpenAI)', 0],
    ['¿Archivo válido?', 'Leer resultado', 1],
    ['Leer documento (OpenAI)', 'Leer resultado'],
    ['Leer resultado', 'Responder']
  ]),
  settings: { ...settings, saveDataSuccessExecution: 'none' },
  pinData: {}
});
