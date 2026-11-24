/* R4 · Guía de implantación interactiva
   Acompaña a R4 paso a paso desde cero hasta que el sistema funciona solo:
   botón de encendido/apagado, panel de acompañamiento, foco luminoso sobre cada elemento,
   detección automática de pasos con los datos reales y plan completo con cálculos.
   Independiente de app.js: solo usa el DOM, location.hash y /api/*. */
(() => {
'use strict';
const KEY = 'r4:guia';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hoyISO = () => new Date().toISOString().slice(0, 10);
const CALC0 = { inicio: hoyISO(), correos: 15, whatsapp: 20, clientes: 60, oportunidades: 25, inmuebles: 40, horasDia: 2, pin: 0.15, pout: 0.60, tin: 1800, tout: 250 };
let S = { on: false, i: 0, done: {}, calc: {} };
try { S = Object.assign(S, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
S.calc = Object.assign({}, CALC0, S.calc || {});
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
let SUM = null, LIVE = false;

const N8N = 'https://r4-n8n.7dklrk.easypanel.host';
const LINKS = {
  n8n: N8N + '/home/workflows', cred: N8N + '/home/credentials',
  evo: 'https://r4-evolution-api.7dklrk.easypanel.host/manager', gcp: 'https://console.cloud.google.com/auth/audience?project=r4-estructuras',
  vercel: 'https://vercel.com/aresiaagency/r4/settings/environment-variables', github: 'https://github.com/aresiaagency-boop/R4-'
};
const pct = (arr, f) => arr && arr.length ? arr.filter(f).length / arr.length : 0;

/* ---------- Pasos: de cero a piloto automático ---------- */
const FASES = [
  { id: 'f0', n: '0 · Puesta en marcha técnica', dias: () => 1 },
  { id: 'f1', n: '1 · Canales de entrada', dias: () => 1 },
  { id: 'f2', n: '2 · Ingesta inicial de datos', dias: c => Math.max(1, Math.ceil(ingestaH(c) / Math.max(0.5, +c.horasDia || 1))) },
  { id: 'f3', n: '3 · Rutina acompañada', dias: () => 10 },
  { id: 'f4', n: '4 · Piloto automático', dias: () => 5 }
];
const STEPS = [
  { id: 'f0-acceso', f: 'f0', t: 'Entrar como Dirección', rol: 'Dirección', min: 2, sec: 'mission-control', sel: '#exit-btn',
    que: 'La plataforma está desplegada en Vercel y protegida con la contraseña de Dirección. Sin sesión todo se ve en modo demostración.',
    pasos: ['Abre la plataforma y pulsa <b>Dirección → Entrar</b>.', 'Escribe la contraseña de <code>R4_PANEL_PASSWORD</code>.', 'Arriba debe aparecer la pastilla verde <b>En vivo</b>.'],
    auto: s => !!s },
  { id: 'f0-flujos', f: 'f0', t: 'Flujos publicados en n8n', rol: 'A.R.E.S. I.A.', min: 10, sec: 'mission-control', sel: '.mc-net', link: ['Abrir n8n', LINKS.n8n],
    que: 'Tres flujos hacen funcionar el sistema: «R4 · API» (plataforma ↔ base de datos), «R4 · ECO» (lee Gmail) y «ATLASR4» (WhatsApp).',
    pasos: ['En n8n, cada flujo debe mostrar <b>1/1 · Published</b>.', 'Credenciales asignadas: Postgres, OpenAI, Gmail, «R4 API key» y «Evolution API R4».', 'El mapa de conexiones de Mission Control debe mostrar n8n <b>En línea</b>.'],
    auto: s => !!s },
  { id: 'f1-gmail', f: 'f1', t: 'Conectar la cuenta Gmail de R4', rol: 'A.R.E.S. I.A.', min: 15, sec: 'configuracion', sel: '#cf-gmail', link: ['Usuarios de prueba (Google)', LINKS.gcp],
    que: 'ECO revisa esa bandeja cada minuto, resume cada correo y extrae los datos del cliente. Solo lee correos nuevos desde que se publica el flujo.',
    pasos: ['La cuenta debe estar en <b>Google Auth Platform → Público → Usuarios de prueba</b>.', 'En n8n, credencial «Gmail account» → <b>Sign in with Google</b> con esa cuenta.', 'Escribe la cuenta en <b>Configuración → Cuenta Gmail de ECO</b> y guarda.', 'Se marca solo cuando llega el primer correo.'],
    datos: 'Cuenta Gmail que recibirá a los clientes.', auto: s => !!(s.config && s.config.gmail_cuenta && s.canales && s.canales.ultimo_gmail) },
  { id: 'f1-qr', f: 'f1', t: 'Vincular el WhatsApp de ATLAS (QR)', rol: 'Dirección', min: 5, sec: 'configuracion', sel: '#cf-inst', link: ['Abrir Evolution Manager', LINKS.evo],
    que: 'La instancia «r4» de Evolution API es el número que atiende a los clientes. Mientras aparezca «Disconnected» no se envía ni se recibe nada.',
    pasos: ['Abre Evolution Manager e inicia sesión con la API key global.', 'En la instancia <b>r4</b> pulsa <b>Get QR Code</b>.', 'En el móvil del número de R4: WhatsApp → Dispositivos vinculados → Vincular → escanea.', 'El estado debe pasar a <b>Connected</b>.'],
    datos: 'Móvil con el número de WhatsApp de R4.', auto: null },
  { id: 'f1-webhook', f: 'f1', t: 'Webhook de Evolution hacia ATLASR4', rol: 'A.R.E.S. I.A.', min: 5, sec: 'mission-control', sel: '.mc-net', link: ['Abrir Evolution Manager', LINKS.evo],
    que: 'Cada WhatsApp que entra llega a n8n, ATLAS responde y el mensaje queda registrado en la Bandeja.',
    pasos: ['Evolution Manager → instancia r4 → <b>Webhook</b>.', 'URL: <code>' + N8N + '/webhook/atlasr4</code> · Enabled.', 'Evento: <code>MESSAGES_UPSERT</code> · guarda.', 'Escribe un WhatsApp de prueba al número de R4: se marca solo.'],
    auto: s => !!(s.canales && s.canales.ultimo_whatsapp) },
  { id: 'f1-ajustes', f: 'f1', t: 'Ajustes de ECO y WhatsApp de Dirección', rol: 'Dirección', min: 5, sec: 'configuracion', sel: '#cfg-form',
    que: 'Indica a qué WhatsApp llegan los avisos de cada cliente nuevo y qué datos se envían.',
    pasos: ['URL de Evolution: <code>https://r4-evolution-api.7dklrk.easypanel.host</code> · Instancia: <code>r4</code>.', '<b>WhatsApp de Dirección</b>: número con prefijo, sin «+» (p. ej. 34655915236). Varios, separados por coma.', 'Marca los datos que quieres recibir y la URL de la plataforma (enlace «Ficha»).', 'Pulsa <b>Guardar ajustes</b>.'],
    datos: 'Número(s) de WhatsApp de Dirección.', auto: s => { const c = s.config || {}; return !!(c.evolution_url && c.evolution_instancia && c.wa_destino_direccion && c.plataforma_url); } },
  { id: 'f1-prueba', f: 'f1', t: 'Prueba completa: correo → ficha → aviso', rol: 'Dirección', min: 5, sec: 'bandeja', sel: '[aria-label="Mensajes recibidos"]',
    que: 'Comprueba toda la cadena antes de cargar datos reales.',
    pasos: ['Desde otra cuenta, envía a la cuenta de R4 un correo como si fueras un cliente (nombre, teléfono, problema y dirección).', 'En menos de 2 minutos aparece en la <b>Bandeja</b> con los datos extraídos.', 'Al WhatsApp de Dirección llega el aviso con el enlace «Ficha».', 'Si algo falla: Bandeja → «Reenviar a WhatsApp» y revisa la credencial de Evolution.'],
    auto: s => !!(s.canales && s.canales.ultimo_aviso_wa) },
  { id: 'f2-reenvio', f: 'f2', t: 'Ingesta: reenviar correos de clientes activos', rol: 'Comercial / atención', min: c => Math.round(c.clientes * 1.5), sec: 'bandeja', sel: '[aria-label="Mensajes recibidos"]',
    que: 'La forma más rápida de cargar la cartera: ECO crea la ficha, la organización, el inmueble y la oportunidad de cada cliente a partir de su último correo.',
    pasos: ['Busca en el correo actual de R4 el último mensaje de cada cliente activo (últimos 90 días).', 'Reenvíalo a la cuenta de R4, en tandas de 20 cada 5 minutos.', 'Clientes sin correo: escribe tú un correo con sus datos (nombre, empresa, teléfono, dirección de la obra, qué necesita).', 'Se marca solo al llegar al 80 % de los clientes previstos en el plan.'],
    datos: c => c.clientes + ' clientes activos previstos', auto: s => (s.kpis && s.kpis.clientes_total || 0) >= Math.max(1, Math.round(S.calc.clientes * 0.8)) },
  { id: 'f2-revisar', f: 'f2', t: 'Revisar y corregir las fichas', rol: 'Dirección', min: c => Math.round(c.clientes * 1), sec: 'bandeja', sel: '[aria-label="Mensajes recibidos"]',
    que: 'La IA acierta casi siempre, pero la primera carga se revisa a mano. Cada corrección mejora las evaluaciones de ECO.',
    pasos: ['Abre cada mensaje de la Bandeja.', 'Si falta o sobra algo: <b>Corregir datos</b>. Si no es cliente: <b>No es cliente</b>.', 'Anota los correos mal clasificados: se añaden a <code>eval/eco-extraccion.jsonl</code>.'], auto: null },
  { id: 'f2-embudo', f: 'f2', t: 'Colocar cada oportunidad en su etapa real', rol: 'Técnico / jefe de obra', min: c => Math.round(c.oportunidades * 0.5), sec: 'crm', sel: '.kanban', prep: () => clickSel('[data-crm-tab="embudo"]'),
    que: 'Todo entra como «Nuevo». Arrastra cada tarjeta con el dedo a su etapa: Contactado, Visita, Presupuesto, Aceptado o Perdido (con motivo).',
    pasos: ['CRM → <b>Embudo</b>.', 'Arrastra la tarjeta por el asa ⠿ o usa «Mover a».', 'Las perdidas piden un motivo: sirve para el análisis comercial.', 'Se marca solo cuando la mitad ya no está en «Nuevo».'],
    auto: s => (s.oportunidades || []).length > 0 && pct(s.oportunidades, o => o.etapa !== 'nuevo') >= 0.5 },
  { id: 'f2-inmuebles', f: 'f2', t: 'Completar inmuebles: año, estructura e IEE', rol: 'Técnico / jefe de obra', min: c => Math.round(c.inmuebles * 2), sec: 'crm', sel: '.crm-shell, .panel', prep: () => clickSel('[data-crm-tab="inmuebles"]'),
    que: 'Con el año de construcción y la fecha del IEE, el sistema avisa de edificios de más de 50 años sin IEE o con el IEE a punto de caducar: son las oportunidades comerciales más claras.',
    pasos: ['CRM → <b>Inmuebles</b> → <b>Editar</b> en cada fila.', 'Año de construcción (4 cifras), tipo de estructura y fecha del último IEE.', 'Revisa las alertas rojas y ámbar: son clientes a contactar.', 'Se marca solo con el 80 % de inmuebles completos.'],
    datos: c => c.inmuebles + ' inmuebles previstos', auto: s => (s.inmuebles || []).length > 0 && pct(s.inmuebles, i => i.alerta_iee !== 'sin_datos') >= 0.8 },
  { id: 'f2-empresa', f: 'f2', t: 'Datos fiscales para la facturación (fase 1)', rol: 'Administración', min: 30, sec: 'hoja-de-ruta', sel: '.panel',
    que: 'Sin estos datos no se puede emitir la primera factura con Verifactu.',
    pasos: ['Razón social, CIF y domicilio fiscal.', 'Forma jurídica (sociedad o autónomo): fija la fecha de Verifactu.', 'Modo de facturación: con o sin VERI*FACTU, o SII.', 'Certificado electrónico, series y último número de factura.'],
    datos: 'Documentación fiscal de R4.', auto: null },
  { id: 'f2-equipo', f: 'f2', t: 'Equipo y teléfonos de encargados', rol: 'Dirección', min: 20, sec: 'configuracion', sel: '.panel',
    que: 'Necesario para el plan de las 7:00 y los partes diarios por WhatsApp (fase 4 de la hoja de ruta).',
    pasos: ['Lista de encargados, técnicos y administración con su rol y móvil.', 'Quién aprueba presupuestos y quién cierra el mes.'], auto: null },
  { id: 'f3-diaria', f: 'f3', t: 'Rutina diaria · 8:00 · Bandeja', rol: 'Dirección', min: c => Math.round(10 + c.correos * 0.3), sec: 'bandeja', sel: '[aria-label="Mensajes recibidos"]', cada: 'Cada día laborable',
    que: 'Los avisos llegan solos al WhatsApp. Por la mañana se revisa lo que ha entrado y se corrige lo dudoso.',
    pasos: ['Abre la Bandeja: los marcados «ECO procesando» se actualizan solos.', 'Corrige o marca «No es cliente» lo que no cuadre.', 'Las urgencias altas (🔴) se llaman antes de las 10:00.'], auto: null },
  { id: 'f3-etapas', f: 'f3', t: 'Tras cada llamada o visita: mover la oportunidad', rol: 'Técnico / comercial', min: 2, sec: 'crm', sel: '.kanban', prep: () => clickSel('[data-crm-tab="embudo"]'), cada: 'Tras cada contacto',
    que: 'El embudo solo es útil si refleja la realidad del día.', pasos: ['CRM → Embudo → arrastra la tarjeta.', 'En la ficha del cliente: WhatsApp, llamar o email con un toque.'], auto: null },
  { id: 'f3-semanal', f: 'f3', t: 'Viernes · revisión de Mission Control', rol: 'Dirección', min: 15, sec: 'mission-control', sel: '.kpis', cada: 'Cada viernes',
    que: 'Diez minutos para ver la semana: mensajes, clientes nuevos, avisos fallidos y alertas IEE.',
    pasos: ['Revisa los 4 indicadores y el mapa de conexiones (todo en verde).', 'Si hay «errores de envío»: revisa Evolution (QR y apikey).', 'Envía a A.R.E.S. I.A. los correos mal clasificados para mejorar ECO.'], auto: null },
  { id: 'f4-errores', f: 'f4', t: 'Criterio 1 · cero errores de WhatsApp', rol: 'Sistema', min: 0, sec: 'mission-control', sel: '.kpis',
    que: 'Los avisos se entregan sin intervención.', pasos: ['Mission Control → Avisos WhatsApp: «Sin errores de envío».'], auto: s => !!(s.canales && s.canales.ultimo_aviso_wa) && (s.kpis && s.kpis.errores_wa) === 0 },
  { id: 'f4-fichas', f: 'f4', t: 'Criterio 2 · cartera completa en el CRM', rol: 'Sistema', min: 0, sec: 'crm', sel: '.crm-shell', prep: () => clickSel('[data-crm-tab="contactos"]'),
    que: 'Todos los clientes activos tienen ficha y llegan solos por Gmail o WhatsApp.', pasos: ['CRM → Contactos: número de contactos ≥ clientes previstos.'], auto: s => (s.kpis && s.kpis.clientes_total || 0) >= S.calc.clientes },
  { id: 'f4-precision', f: 'f4', t: 'Criterio 3 · ECO acierta sin correcciones', rol: 'Dirección', min: 0, sec: 'bandeja', sel: '[aria-label="Mensajes recibidos"]',
    que: 'Dos semanas seguidas sin corregir más del 5 % de los correos.', pasos: ['Si sigues corrigiendo a menudo, pide a A.R.E.S. I.A. una nueva versión del prompt (skill eco-eval).'], auto: null },
  { id: 'f4-apagar', f: 'f4', t: 'El sistema va solo: apaga la guía', rol: 'Dirección', min: 1, sec: 'mission-control', sel: '.g-fab',
    que: 'A partir de aquí ECO y ATLAS trabajan solos y la Dirección solo decide. La guía se puede volver a encender cuando quieras (por ejemplo, al empezar la fase de facturación).',
    pasos: ['Pulsa el interruptor <b>Guía</b> para apagarla.'], auto: null, accion: ['Apagar la guía', () => setOn(false)] }
];
const minOf = st => typeof st.min === 'function' ? st.min(S.calc) : st.min;
const datosOf = st => typeof st.datos === 'function' ? st.datos(S.calc) : st.datos;
const autoOf = st => { if (!st.auto || !SUM) return null; try { return !!st.auto(SUM); } catch (e) { return null; } };
const isDone = st => !!S.done[st.id] || autoOf(st) === true;
const progreso = () => Math.round(STEPS.filter(isDone).length * 100 / STEPS.length);
function ingestaMin(c){ return c.clientes * 2.5 + c.oportunidades * 0.5 + c.inmuebles * 2; }
function ingestaH(c){ return ingestaMin(c) / 60; }
function addLaborables(d, n){ const x = new Date(d + 'T12:00:00'); let k = 0; while (k < n){ x.setDate(x.getDate() + 1); const w = x.getDay(); if (w !== 0 && w !== 6) k++; } return x; }
const fmtD = d => d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const nf = (v, d = 0) => Number(v).toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });

/* ---------- datos reales (si hay sesión) ---------- */
async function cargarVivo(){
  try {
    const s = await fetch('/api/session', { cache: 'no-store' }).then(r => r.json());
    LIVE = !!s.authenticated;
    if (LIVE){ const r = await fetch('/api/r4?op=summary', { cache: 'no-store' }); const j = await r.json(); SUM = r.ok ? (j.data || j) : null; } else SUM = null;
  } catch (e) { LIVE = false; SUM = null; }
  if (S.on) pintarDock(); if (planEl) pintarPlan();
}

/* ---------- botón flotante ON/OFF ---------- */
const fab = document.createElement('button');
fab.type = 'button'; fab.className = 'g-fab'; fab.setAttribute('aria-label', 'Guía de implantación: encender o apagar');
document.body.appendChild(fab);
function pintarFab(){ fab.setAttribute('aria-pressed', String(S.on)); fab.innerHTML = `<span class="g-sw" aria-hidden="true"></span><span>Guía<small>${S.on ? 'Activada · ' + progreso() + ' %' : 'Apagada'}</small></span>`; }
fab.addEventListener('click', () => setOn(!S.on));
function setOn(v){ S.on = v; save(); pintarFab(); if (v){ pintarDock(); irA(STEPS[S.i], false); cargarVivo(); } else { cerrarDock(); quitarFoco(); } }

/* ---------- panel de acompañamiento ---------- */
let dock = null;
function cerrarDock(){ if (dock){ dock.remove(); dock = null; } }
function pintarDock(){
  if (!S.on) return;
  if (!dock){ dock = document.createElement('aside'); dock.className = 'g-dock'; dock.setAttribute('aria-label', 'Guía de implantación paso a paso'); document.body.appendChild(dock); dock.addEventListener('click', onDock); }
  S.i = Math.max(0, Math.min(STEPS.length - 1, S.i));
  const st = STEPS[S.i], fase = FASES.find(f => f.id === st.f), a = autoOf(st), hecho = isDone(st), p = progreso();
  const datos = datosOf(st);
  dock.innerHTML = `<div class="g-in">
    <div class="g-head"><b>Guía de implantación</b><span class="g-chip">${p} %</span><button class="btn g-x" type="button" data-g="plan">Plan completo</button></div>
    <div class="g-bar" aria-hidden="true"><i style="width:${p}%"></i></div>
    <div class="g-steps" role="list" aria-label="Pasos">${STEPS.map((s, k) => `<button type="button" role="listitem" data-g="paso" data-k="${k}" class="${isDone(s) ? 'done' : ''}" ${k === S.i ? 'aria-current="step"' : ''} title="${esc(s.t)}">${k + 1}</button>`).join('')}</div>
    <span class="g-fase">Fase ${esc(fase.n)} · paso ${S.i + 1} de ${STEPS.length}</span>
    <h3 class="g-t">${esc(st.t)}</h3>
    <div class="g-meta"><span class="g-chip">${esc(st.rol)}</span>${minOf(st) ? `<span class="g-chip">≈ ${nf(minOf(st))} min</span>` : ''}${st.cada ? `<span class="g-chip">${esc(st.cada)}</span>` : ''}${hecho ? '<span class="g-chip ok">Hecho</span>' : a === false ? '<span class="g-chip auto">Se comprueba solo</span>' : ''}</div>
    <p class="g-p">${st.que}</p>
    <ol class="g-ol">${st.pasos.map(x => `<li>${x}</li>`).join('')}</ol>
    ${datos ? `<div class="g-box"><b>Necesitas:</b> ${esc(datos)}</div>` : ''}
    ${!LIVE && st.auto ? '<div class="g-box">Entra como Dirección para que la guía compruebe este paso con los datos reales.</div>' : ''}
    <div class="g-act"><button class="btn primary" type="button" data-g="ir">Señálamelo</button>${st.link ? `<a class="btn" href="${st.link[1]}" target="_blank" rel="noopener">${esc(st.link[0])} ↗</a>` : ''}${st.accion ? `<button class="btn" type="button" data-g="accion">${esc(st.accion[0])}</button>` : ''}</div>
    <div class="g-nav"><button class="btn" type="button" data-g="prev" ${S.i === 0 ? 'disabled' : ''}>‹ Anterior</button><button class="btn" type="button" data-g="hecho">${S.done[st.id] ? 'Desmarcar' : 'Marcar hecho'}</button><button class="btn primary" type="button" data-g="next" ${S.i === STEPS.length - 1 ? 'disabled' : ''}>Siguiente ›</button></div>
  </div>`;
  pintarFab();
}
function onDock(e){
  const b = e.target.closest('[data-g]'); if (!b) return;
  const g = b.dataset.g, st = STEPS[S.i];
  if (g === 'plan') return abrirPlan();
  if (g === 'ir') return irA(st, true);
  if (g === 'accion' && st.accion) return st.accion[1]();
  if (g === 'hecho'){ S.done[st.id] = !S.done[st.id]; save(); pintarDock(); if (S.done[st.id] && S.i < STEPS.length - 1){ S.i++; save(); pintarDock(); irA(STEPS[S.i], false); } return; }
  if (g === 'prev'){ S.i--; save(); pintarDock(); irA(STEPS[S.i], false); return; }
  if (g === 'next'){ S.i++; save(); pintarDock(); irA(STEPS[S.i], false); return; }
  if (g === 'paso'){ S.i = +b.dataset.k; save(); pintarDock(); irA(STEPS[S.i], false); }
}

/* ---------- foco luminoso sobre el elemento de cada paso ---------- */
let spot = null, tip = null, objetivo = null;
function clickSel(sel){ const el = document.querySelector(sel); if (el && el.getAttribute('aria-pressed') !== 'true') el.click(); }
function quitarFoco(){ if (spot){ spot.remove(); spot = null; } if (tip){ tip.remove(); tip = null; } objetivo = null; }
function irA(st, conFoco){
  quitarFoco();
  const portal = document.getElementById('portal');
  const enPortal = portal && !portal.hidden;
  if (!enPortal && st.sec && location.hash !== '#' + st.sec) location.hash = '#' + st.sec;
  if (!conFoco) return;
  let n = 0;
  const buscar = () => {
    if (st.prep && n === 2) try { st.prep(); } catch (e) {}
    const sel = enPortal ? '#portal-dir' : st.sel;
    const el = sel && [...document.querySelectorAll(sel)].find(x => x.offsetParent !== null || x === fab);
    if (el && n >= 3){ objetivo = el; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => dibujarFoco(st), 420); return; }
    if (n++ < 14) setTimeout(buscar, 150);
  };
  buscar();
}
function dibujarFoco(st){
  if (!objetivo) return;
  const r = objetivo.getBoundingClientRect(), m = 8;
  if (!spot){ spot = document.createElement('div'); spot.className = 'g-spot'; document.body.appendChild(spot); }
  Object.assign(spot.style, { left: (r.left - m) + 'px', top: (r.top - m) + 'px', width: (r.width + m * 2) + 'px', height: (Math.min(r.height, innerHeight - 40) + m * 2) + 'px' });
  if (!tip){ tip = document.createElement('div'); tip.className = 'g-tip'; tip.setAttribute('role', 'note'); document.body.appendChild(tip); }
  tip.innerHTML = `<b>Paso ${S.i + 1} · ${esc(st.t)}</b>${st.pasos[0]}<div><button class="btn" type="button" data-g-cerrar>Entendido</button></div>`;
  const below = r.bottom + 14 + 140 < innerHeight;
  tip.style.top = (below ? r.bottom + 14 : Math.max(12, r.top - tip.offsetHeight - 14)) + 'px';
  tip.style.left = Math.max(12, Math.min(r.left, innerWidth - tip.offsetWidth - 12)) + 'px';
}
document.addEventListener('click', e => { if (e.target.closest('[data-g-cerrar]')) quitarFoco(); });
addEventListener('scroll', () => { if (objetivo && spot) dibujarFoco(STEPS[S.i]); }, { passive: true });
addEventListener('resize', () => { if (objetivo && spot) dibujarFoco(STEPS[S.i]); });
addEventListener('hashchange', () => { if (spot && objetivo && !document.body.contains(objetivo)) quitarFoco(); });
addEventListener('keydown', e => { if (e.key === 'Escape'){ if (planEl) cerrarPlan(); else quitarFoco(); } });

/* ---------- plan completo con cálculos ---------- */
let planEl = null;
function cerrarPlan(){ if (planEl){ planEl.remove(); planEl = null; document.body.style.overflow = ''; } }
function abrirPlan(){ quitarFoco(); if (!planEl){ planEl = document.createElement('div'); planEl.className = 'g-plan'; planEl.setAttribute('role', 'dialog'); planEl.setAttribute('aria-label', 'Plan de implantación de R4'); document.body.appendChild(planEl); planEl.addEventListener('click', onPlan); planEl.addEventListener('input', onCalc); } document.body.style.overflow = 'hidden'; pintarPlan(); cargarVivo(); }
function calculos(){
  const c = S.calc;
  const fechas = []; let d = c.inicio || hoyISO();
  FASES.forEach(f => { const dias = f.dias(c); const ini = new Date(d + 'T12:00:00'); const fin = addLaborables(d, Math.max(0, dias - 1)); fechas.push({ f, dias, ini, fin }); d = addLaborables(fin.toISOString().slice(0, 10), 1).toISOString().slice(0, 10); });
  const costeEco = c.correos * 30 * (c.tin * c.pin + c.tout * c.pout) / 1e6;
  const costeAtlas = c.whatsapp * 30 * (1200 * c.pin + 150 * c.pout) / 1e6;
  return {
    fechas, autopiloto: fechas[fechas.length - 1].ini,
    ingestaH: ingestaH(c), diasIngesta: FASES[2].dias(c),
    costeMes: costeEco + costeAtlas, costeEco, costeAtlas,
    avisosMes: Math.round(c.correos * 0.45 * 30), bdMB: (c.correos + c.whatsapp) * 365 * 6 / 1024,
    ahorroH: (c.correos * 4 + c.whatsapp * 1.5) * 22 / 60, rutinaMin: Math.round(10 + c.correos * 0.3),
    totalH: STEPS.filter(s => !s.cada).reduce((a, s) => a + (minOf(s) || 0), 0) / 60
  };
}
const CAMPOS = [['inicio', 'Fecha de inicio', 'date'], ['correos', 'Correos al día', 'number'], ['whatsapp', 'WhatsApp al día', 'number'], ['clientes', 'Clientes activos a cargar', 'number'], ['oportunidades', 'Oportunidades abiertas', 'number'], ['inmuebles', 'Inmuebles / edificios', 'number'], ['horasDia', 'Horas al día para la carga', 'number'], ['pin', 'IA · USD por 1M tokens de entrada', 'number'], ['pout', 'IA · USD por 1M tokens de salida', 'number'], ['tin', 'Tokens de entrada por correo', 'number'], ['tout', 'Tokens de salida por correo', 'number']];
function pintarPlan(){
  if (!planEl) return;
  const k = calculos(), c = S.calc, p = progreso();
  const filaFase = x => { const pasos = STEPS.filter(s => s.f === x.f.id), hechos = pasos.filter(isDone).length, pc = Math.round(hechos * 100 / pasos.length);
    return `<div class="g-tl-row"><div><b>${esc(x.f.n)}</b><small>${x.dias} día${x.dias > 1 ? 's' : ''} laborable${x.dias > 1 ? 's' : ''} · ${hechos}/${pasos.length} pasos</small></div><div class="g-bar"><i style="width:${pc}%"></i></div><div class="g-d">${fmtD(x.ini)}${x.dias > 1 ? ' → ' + fmtD(x.fin) : ''}</div></div>`; };
  planEl.innerHTML = `<div class="g-plan-in">
    <div class="g-plan-top"><h2>Plan de implantación de R4</h2><span class="g-chip ${p === 100 ? 'ok' : ''}">${p} % completado</span><span class="g-chip ${LIVE ? 'auto' : ''}">${LIVE ? 'Comprobando con datos reales' : 'Sin sesión: comprobación manual'}</span>
      <div class="g-r"><button class="btn ${S.on ? '' : 'primary'}" type="button" data-p="toggle">${S.on ? 'Apagar guía' : 'Encender guía'}</button><button class="btn" type="button" data-p="reset">Reiniciar progreso</button><button class="btn primary" type="button" data-p="cerrar">Cerrar ✕</button></div></div>
    <div class="g-grid2">
      <section class="panel"><header><h2>Datos de partida · edítalos</h2></header><div class="body"><div class="g-calc">${CAMPOS.map(([id, l, t]) => `<label for="gc-${id}">${l}<input id="gc-${id}" data-c="${id}" type="${t}" ${t === 'number' ? 'min="0" step="any" inputmode="decimal"' : ''} value="${esc(c[id])}"></label>`).join('')}</div>
        <p class="g-p" style="margin-top:10px">Los precios de la IA son orientativos: cámbialos si OpenAI actualiza su tarifa. Todo se recalcula al momento y se guarda en este navegador.</p></div></section>
      <section class="panel"><header><h2>Resultado del cálculo</h2></header><div class="body"><div class="g-out">
        <div><span>Piloto automático</span><strong>${fmtD(k.autopiloto)}</strong><em>R4 funciona sola desde esa fecha</em></div>
        <div><span>Carga inicial</span><strong>${nf(k.ingestaH, 1)} h</strong><em>${k.diasIngesta} días a ${nf(c.horasDia, 1)} h/día</em></div>
        <div><span>Dedicación total de la puesta en marcha</span><strong>${nf(k.totalH, 1)} h</strong><em>sin contar la rutina diaria</em></div>
        <div><span>Rutina diaria tras arrancar</span><strong>${k.rutinaMin} min</strong><em>revisión de Bandeja a las 8:00</em></div>
        <div><span>Coste de IA al mes</span><strong>${nf(k.costeMes, 2)} USD</strong><em>ECO ${nf(k.costeEco, 2)} · ATLAS ${nf(k.costeAtlas, 2)}</em></div>
        <div><span>Avisos de WhatsApp al mes</span><strong>≈ ${nf(k.avisosMes)}</strong><em>~45 % de los correos son de clientes</em></div>
        <div><span>Tiempo ahorrado al mes</span><strong>≈ ${nf(k.ahorroH, 0)} h</strong><em>4 min por correo y 1,5 min por WhatsApp</em></div>
        <div><span>Crecimiento de la base de datos</span><strong>${nf(k.bdMB, 1)} MB/año</strong><em>Postgres en EasyPanel</em></div>
      </div></div></section>
    </div>
    <section class="panel"><header><h2>Calendario por fases</h2><div class="meta">Días laborables desde ${esc(c.inicio)}</div></header><div class="body"><div class="g-tl">${k.fechas.map(filaFase).join('')}</div></div></section>
    <section class="panel"><header><h2>Alimentación de datos · cuándo entra cada cosa</h2></header><div class="body flush"><div class="tbl-wrap"><table class="g-feed"><thead><tr><th>Cuándo</th><th>Qué entra</th><th>Quién / qué lo hace</th><th>Dónde se ve</th></tr></thead><tbody>
      <tr><td>Cada minuto</td><td>Correos nuevos de clientes</td><td>ECO (automático): resume, extrae y crea ficha, organización, inmueble y oportunidad</td><td>Bandeja · CRM</td></tr>
      <tr><td>Al instante</td><td>WhatsApp de clientes</td><td>ATLAS (automático): responde, pide datos y fotos, registra el mensaje</td><td>Bandeja</td></tr>
      <tr><td>Al instante</td><td>Aviso a Dirección</td><td>ECO → Evolution (automático) con el enlace «Ficha»</td><td>WhatsApp de Dirección</td></tr>
      <tr><td>Semana 1 (fase 2)</td><td>Cartera actual de clientes</td><td>Comercial: reenvía el último correo de cada cliente · ${nf(c.clientes)} clientes ≈ ${nf(c.clientes * 1.5 / 60, 1)} h</td><td>CRM</td></tr>
      <tr><td>Semana 1 (fase 2)</td><td>Datos de edificios (año, IEE)</td><td>Técnico: ${nf(c.inmuebles)} inmuebles ≈ ${nf(c.inmuebles * 2 / 60, 1)} h</td><td>CRM → Inmuebles</td></tr>
      <tr><td>Diario · 8:00</td><td>Revisión y correcciones</td><td>Dirección · ${k.rutinaMin} min</td><td>Bandeja</td></tr>
      <tr><td>Tras cada contacto</td><td>Etapa de la oportunidad</td><td>Técnico o comercial · 2 min</td><td>CRM → Embudo</td></tr>
      <tr><td>Viernes</td><td>Revisión semanal y casos para mejorar ECO</td><td>Dirección · 15 min</td><td>Mission Control</td></tr>
      <tr><td>Fase 4 · 7:00 y 18:00</td><td>Plan del día y partes de obra</td><td>KAIRÓS y HEFESTO por WhatsApp (próximas fases)</td><td>Planning · Costes</td></tr>
      <tr><td>Día 1–5 de cada mes</td><td>Cierre mensual</td><td>PLUTO prepara, Dirección cierra (fase 5)</td><td>Finanzas</td></tr>
    </tbody></table></div></div></section>
    <section class="panel"><header><h2>Todos los pasos</h2><div class="meta">${STEPS.filter(isDone).length} de ${STEPS.length} hechos</div></header><div class="body"><ul class="g-list">${STEPS.map((s, i) => { const a = autoOf(s); return `<li><span class="g-ck ${isDone(s) ? 'ok' : ''}" aria-hidden="true">${isDone(s) ? '✓' : i + 1}</span><span><b>${esc(s.t)}</b><br><span class="g-p" style="font-size:13px">${esc(FASES.find(f => f.id === s.f).n)} · ${esc(s.rol)}${minOf(s) ? ' · ≈ ' + nf(minOf(s)) + ' min' : ''}${s.cada ? ' · ' + esc(s.cada) : ''}${s.auto ? (a === true ? ' · comprobado con datos reales' : ' · se comprueba solo') : ''}</span></span><button class="lnk" type="button" data-p="ir" data-k="${i}">Llévame</button></li>`; }).join('')}</ul></div></section>
  </div>`;
}
function onPlan(e){
  const b = e.target.closest('[data-p]'); if (!b) return;
  const g = b.dataset.p;
  if (g === 'cerrar') return cerrarPlan();
  if (g === 'toggle'){ setOn(!S.on); pintarPlan(); return; }
  if (g === 'reset'){ S.done = {}; S.i = 0; save(); pintarPlan(); if (S.on) pintarDock(); return; }
  if (g === 'ir'){ S.i = +b.dataset.k; if (!S.on){ S.on = true; } save(); cerrarPlan(); pintarFab(); pintarDock(); irA(STEPS[S.i], true); }
}
function onCalc(e){
  const id = e.target.dataset.c; if (!id) return;
  S.calc[id] = e.target.type === 'number' ? Math.max(0, parseFloat(String(e.target.value).replace(',', '.')) || 0) : e.target.value;
  save();
  const focusId = e.target.id, pos = e.target.selectionStart;
  pintarPlan();
  const f = document.getElementById(focusId); if (f){ f.focus(); try { if (pos != null) f.setSelectionRange(pos, pos); } catch (err) {} }
  if (S.on) pintarDock();
}

/* ---------- entrada en la barra de secciones ---------- */
function enlaceNav(){
  const nav = document.getElementById('nav'); if (!nav || nav.querySelector('[data-guia]')) return;
  const a = document.createElement('a'); a.href = '#implantacion'; a.dataset.guia = '1';
  a.innerHTML = '<span class="code">12</span><span class="name">Implantación</span><span class="sub">Guía paso a paso y cálculos</span>';
  a.addEventListener('click', ev => { ev.preventDefault(); abrirPlan(); });
  nav.appendChild(a);
}

/* ---------- arranque ---------- */
enlaceNav(); pintarFab();
if (S.on) pintarDock();
if (location.hash === '#implantacion') abrirPlan();
cargarVivo();
/* cuando la plataforma pasa a «En vivo» (inicio de sesión), la guía se actualiza al momento */
const pillVivo = document.getElementById('src-pill');
if (pillVivo) new MutationObserver(() => { const vivo = /En vivo/.test(pillVivo.textContent); if (vivo !== LIVE) cargarVivo(); }).observe(pillVivo, { childList: true, characterData: true, subtree: true });
setInterval(() => { if ((S.on || planEl) && document.visibilityState === 'visible') cargarVivo(); }, 60000);
})();
