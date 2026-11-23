(function(){
const eur = new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0});
const eur2 = new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2});
const pct = v => v.toLocaleString('es-ES',{maximumFractionDigits:1}) + ' %';
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const store = {
  get(k, d){ try{ const v = localStorage.getItem('r4:'+k); return v === null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('r4:'+k, JSON.stringify(v)); }catch(e){} }
};
const VF = {
  verifactu:{label:'Con VERI*FACTU', badge:'acc', reg:'Enviada a la AEAT', short:'VERI*FACTU'},
  noverifactu:{label:'Sin VERI*FACTU', badge:'info', reg:'Registrada y firmada', short:'No VERI*FACTU'},
  sii:{label:'SII', badge:'warn', reg:'Exportada al SII', short:'SII'}
};
let saved = store.get('vfMode','verifactu'); if (!VF[saved]) saved = 'verifactu';
const state = { vfMode: saved, msg: 0, iva: 'red', period: 'semana' };

/* Secciones con la estructura de Ágora Hispana: código, nombre y descripción */
const sections = [
  {id:'mission-control', code:'00', name:'Mission Control', sub:'Estado de obras en tiempo real'},
  {id:'crm', code:'01', name:'CRM', sub:'Clientes, inmuebles y oportunidades'},
  {id:'bandeja', code:'02', name:'Bandeja', sub:'WhatsApp y Gmail'},
  {id:'presupuestos', code:'03', name:'Presupuestos', sub:'Catálogo y mediciones'},
  {id:'obras', code:'04', name:'Obras', sub:'Ficha y diario fotográfico'},
  {id:'planning', code:'05', name:'Planning', sub:'Calendario y cuadrillas'},
  {id:'costes', code:'06', name:'Costes', sub:'Por rangos de tiempo'},
  {id:'facturacion', code:'07', name:'Facturación', sub:'Facturas y VERI*FACTU'},
  {id:'finanzas', code:'08', name:'Finanzas', sub:'Control mensual'},
  {id:'atlas', code:'09', name:'ATLAS', sub:'Orquestador inteligente'},
  {id:'configuracion', code:'10', name:'Configuración', sub:'Empresa, roles y Verifactu'},
  {id:'hoja-de-ruta', code:'11', name:'Hoja de ruta', sub:'Fases y datos pendientes de R4'}
];
/* ---------- datos de ejemplo ---------- */
const obras = [
  {id:'OB-26-031', cliente:'CP Edificio Miramar', lugar:"s'Arenal", trabajo:'Reparación de pilares y vigas con aluminosis', fase:'Refuerzo', avance:62, pres:48600, real:27400, prev:29100, fin:'19 dic'},
  {id:'OB-26-034', cliente:'Hotel Cala Blava', lugar:'Llucmajor', trabajo:'Mecanoviga en forjado de planta 2', fase:'Apuntalamiento', avance:18, pres:86200, real:21020, prev:15800, fin:'26 feb'},
  {id:'OB-26-036', cliente:'AF Son Verí', lugar:'Palma', trabajo:'Anticarbonatación y membrana en fachada', fase:'Protección', avance:85, pres:22400, real:17100, prev:18000, fin:'28 nov'},
  {id:'OB-26-038', cliente:'Promociones Llevant', lugar:'Manacor', trabajo:'Rehabilitación de forjados de madera', fase:'Diagnóstico', avance:6, pres:64900, real:2900, prev:3600, fin:'30 abr'},
  {id:'OB-26-029', cliente:'Particular', lugar:'Inca', trabajo:'Inyección contra humedad por capilaridad', fase:'Parada · secado', avance:90, pres:9800, real:8700, prev:8500, fin:'5 dic'}
];
const health = o => { const k = o.real / o.prev; return k > 1.2 ? 'crit' : k > 1.02 ? 'warn' : 'ok'; };
const healthLabel = {ok:'En plan', warn:'Vigilar', crit:'En riesgo'};

const feed = [
  {t:'08:02', a:'ECO', s:'3 correos de clientes resumidos; datos enviados al WhatsApp de Dirección.'},
  {t:'08:15', a:'KAIRÓS', s:'Plan del día enviado a 4 encargados por WhatsApp.'},
  {t:'09:40', a:'HEFESTO', s:'OB-26-034 lleva el 133 % del coste previsto a la fecha con un 18 % de avance.', lvl:'crit'},
  {t:'10:05', a:'EUNOMÍA', s:'Certificación nº 3 de OB-26-031 lista para emitir: 9.720 € de base.'},
  {t:'11:20', a:'ATLAS', s:'WhatsApp nuevo: comunidad de Palma pide visita por grietas en vigas del garaje.'},
  {t:'12:00', a:'PLUTO', s:'Cobro con más de 60 días: Promociones Llevant, 6.420 €.', lvl:'warn'},
  {t:'12:30', a:'HEFESTO', s:'Los puntales de OB-26-029 siguen alquilados con la obra parada desde el 18 nov.', lvl:'warn'}
];

const pipeline = [
  {etapa:'Nuevo', deals:[
    {t:'Grietas en vigas del garaje', who:'CP Avinguda Argentina · Palma', ch:'WhatsApp', urg:'alta'},
    {t:'Humedad en muros de planta baja', who:'Particular · Llucmajor', ch:'WhatsApp', urg:'media'}]},
  {etapa:'Contactado', deals:[
    {t:'IEE con deficiencias estructurales', who:'CP Son Ferriol · Palma', ch:'Gmail', urg:'media', iee:true}]},
  {etapa:'Visita de diagnóstico', deals:[
    {t:'Aluminosis en forjado', who:"CP Edificio Neptuno · s'Arenal", ch:'Visita 21 nov', urg:'alta'},
    {t:'Refuerzo de pilar para reforma', who:'Estudio de arquitectura · Palma', ch:'Visita 26 nov', urg:'baja'}]},
  {etapa:'Presupuesto enviado', deals:[
    {t:'Protección de fachada', who:'Hotel Ses Roques · Calvià', ch:'38.900 €', urg:'media'},
    {t:'Encamisado de pilares', who:'Promociones Llevant · Manacor', ch:'21.700 €', urg:'baja'}]},
  {etapa:'Aceptado', deals:[
    {t:'Mecanoviga en forjado de planta 2', who:'Hotel Cala Blava · Llucmajor', ch:'86.200 €', urg:''}]}
];
const inmuebles = [
  {dir:'Av. Argentina 41, Palma', anio:1968, est:'Hormigón armado', iee:'Sin IEE', alerta:'crit'},
  {dir:"C/ Neptú 12, s'Arenal", anio:1972, est:'Viguetas pretensadas', iee:'2017 · renovar en 2027', alerta:'warn'},
  {dir:'C/ Major 3, Inca', anio:1931, est:'Muros de mampostería', iee:'2021', alerta:'ok'}
];
const mensajes = [
  {ch:'gmail', t:'08:01', subj:'Solicitud de presupuesto · grietas en vigas del garaje',
   prev:'Buenos días, somos la administración del edificio de Av. Argentina 41. En la última junta se detectaron grietas en dos vigas del garaje y nos gustaría una visita...',
   x:{nombre:'Carmen Vidal', empresa:'Administración de Fincas Portixol', email:'c.vidal@fincas-portixol.example', tel:'+34 600 000 101', resumen:'Administra la comunidad de Av. Argentina 41 (Palma). Grietas en dos vigas del garaje detectadas en la última junta. Pide visita de diagnóstico esta semana y presupuesto para la junta de diciembre.', servicio:'Reparación del hormigón', urg:'alta', estado:'Enviado a WhatsApp 08:02', cliente:true}},
  {ch:'wa', t:'07:48', subj:'Humedad en paredes de la planta baja',
   prev:'Hola, tenemos manchas de humedad que suben por las paredes de la planta baja en una casa de Llucmajor. ¿Hacéis inyecciones?',
   x:{nombre:'Miquel Pons', empresa:'Particular', email:'no indicado', tel:'+34 600 000 202', resumen:'Vivienda unifamiliar en Llucmajor con humedad por capilaridad en muros de planta baja. Pregunta por el tratamiento de inyección y plazos.', servicio:'Humedad por capilaridad', urg:'media', estado:'Ficha creada · oportunidad Nuevo', cliente:true}},
  {ch:'gmail', t:'07:30', subj:'IEE del edificio · deficiencias estructurales',
   prev:'Adjuntamos el informe IEE que nos marca deficiencias en pilares de la planta sótano. Queremos saber qué opciones de reparación hay...',
   x:{nombre:'Antoni Riera', empresa:'CP Son Ferriol', email:'presidencia.sonferriol@correo.example', tel:'+34 600 000 303', resumen:'Presidente de la comunidad. El IEE marca deficiencias en pilares del sótano. Pide opciones de reparación y presupuesto orientativo; adjunta el informe.', servicio:'Reparación del hormigón · IEE', urg:'media', estado:'Actividad añadida a su ficha', cliente:true}},
  {ch:'gmail', t:'06:55', subj:'Novedades de producto · noviembre',
   prev:'Descubre los nuevos morteros de reparación estructural y las jornadas técnicas de diciembre...',
   x:{cliente:false, estado:'Ignorado · R4/Ignorado'}}
];

const lineas = [
  {cod:'AUX-APU', d:'Apuntalamiento de forjado con puntales metálicos', u:'día', q:30, p:95},
  {cod:'REF-MEC', d:'Sustitución funcional de vigueta con sistema Mecanoviga', u:'ud', q:24, p:410},
  {cod:'REP-VIG', d:'Reparación de vigueta: saneado, pasivado y mortero de reparación', u:'ml', q:36, p:68},
  {cod:'PRO-ANT', d:'Pintura anticarbonatación en cara inferior del forjado', u:'m²', q:140, p:18.5},
  {cod:'SUB-CAL', d:'Estudio de cálculo por proyecto (ingeniería colaboradora)', u:'ud', q:1, p:950}
];
const presupuestos = [
  {n:'P-26-112', cliente:'CP Edificio Neptuno', trabajo:'Aluminosis en forjado', estado:'Pendiente de Dirección', s:'warn'},
  {n:'P-26-111', cliente:'Hotel Ses Roques', trabajo:'Protección de fachada', estado:'Enviado 14 nov', s:'info', imp:38900},
  {n:'P-26-109', cliente:'Promociones Llevant', trabajo:'Encamisado de pilares', estado:'Enviado 6 nov', s:'info', imp:21700},
  {n:'P-26-104', cliente:'Hotel Cala Blava', trabajo:'Mecanoviga planta 2', estado:'Aceptado y firmado', s:'ok', imp:86200}
];

const diario = [
  {f:'21 nov', c:'Saneado de vigueta V-7, armadura expuesta'},
  {f:'21 nov', c:'Pasivador aplicado en V-7 y V-8'},
  {f:'20 nov', c:'Mortero de reparación en pilar P-3'},
  {f:'20 nov', c:'Encamisado de P-3: armado antes de cerrar'},
  {f:'19 nov', c:'Apeo metálico provisional en jácena J-2'},
  {f:'18 nov', c:'Retirada de recubrimiento en zuncho perimetral'},
  {f:'17 nov', c:'Marcado de fisuras para inyección'},
  {f:'14 nov', c:'Estado inicial de pilares del garaje'}
];
const fases = [
  {n:'Apuntalamiento', s:'done', f:'3–7 nov'},
  {n:'Reparación de pilares y vigas', s:'done', f:'10–21 nov'},
  {n:'Refuerzo: encamisado y empresillado', s:'now', f:'24 nov – 5 dic'},
  {n:'Protección anticarbonatación', s:'', f:'9–16 dic'},
  {n:'Retirada de apeos y limpieza', s:'', f:'17–19 dic'}
];

const dias = ['Lun 23','Mar 24','Mié 25','Jue 26','Vie 27'];
const equipos = [
  {n:'Equipo A', r:'Oficial + 2 peones', d:['o1','o1','o1','o1','o1']},
  {n:'Equipo B', r:'Oficial + peón', d:['o3','o3','o3',null,'o3']},
  {n:'Equipo C', r:'Montadores Mecanoviga', d:['o2','o2','o2','o2','o2']},
  {n:'Técnico', r:'Diagnóstico y mediciones', d:['vis','o4','o4','vis','o1']}
];
const obraName = {o1:['OB-26-031','Miramar'], o2:['OB-26-034','Cala Blava'], o3:['OB-26-036','Son Verí'], o4:['OB-26-038','Llevant'], o5:['OB-26-029','Inca']};
const costes = {
  semana:[
    {p:'S44 · 26 oct–1 nov', mo:2240, mat:1150, med:1330, sub:950, gen:420, prev:4300},
    {p:'S45 · 2–8 nov', mo:2580, mat:860, med:1330, sub:0, gen:420, prev:3900},
    {p:'S46 · 9–15 nov', mo:2100, mat:1640, med:1330, sub:0, gen:420, prev:3700},
    {p:'S47 · 16–22 nov', mo:1890, mat:610, med:1330, sub:0, gen:420, prev:3900}],
  quincena:[
    {p:'Q1 · 26 oct–8 nov', mo:4820, mat:2010, med:2660, sub:950, gen:840, prev:8200},
    {p:'Q2 · 9–22 nov', mo:3990, mat:2250, med:2660, sub:0, gen:840, prev:7600}],
  mes:[
    {p:'Octubre · 26–31 oct', mo:1920, mat:1150, med:1140, sub:950, gen:360, prev:3690},
    {p:'Noviembre · 1–22 nov', mo:6890, mat:3110, med:4180, sub:0, gen:1320, prev:12110}]
};
const tramos = [
  {cat:'Oficial de 1ª', ord:28, ext:36, fes:42},
  {cat:'Oficial de 2ª', ord:25, ext:32, fes:38},
  {cat:'Peón', ord:22, ext:29, fes:34},
  {cat:'Montador Mecanoviga', ord:31, ext:40, fes:46}
];

const facturas = [
  {n:'F-2026-0141', f:'20 nov', cli:'CP Edificio Miramar', con:'Certificación nº 2 · OB-26-031', base:14800, iva:0.10, tipo:'10 %', cobro:'Pendiente · vence 20 dic', s:'warn'},
  {n:'F-2026-0140', f:'15 nov', cli:'Hotel Cala Blava', con:'Anticipo 30 % · OB-26-034', base:25860, iva:0.21, tipo:'21 %', cobro:'Cobrada 18 nov', s:'ok'},
  {n:'F-2026-0139', f:'10 nov', cli:'Construcciones Migjorn', con:'Subcontrata de refuerzo · inversión del sujeto pasivo', base:7300, iva:0, tipo:'ISP', cobro:'Pendiente · vence 10 dic', s:'warn'},
  {n:'F-2026-0129', f:'31 oct', cli:'AF Son Verí', con:'Certificación nº 1 · OB-26-036', base:9600, iva:0.10, tipo:'10 %', cobro:'Cobrada 12 nov', s:'ok'},
  {n:'F-2026-0118', f:'24 sep', cli:'Promociones Llevant', con:'Diagnóstico y cálculo · OB-26-038', base:5306, iva:0.21, tipo:'21 %', cobro:'Vencida · 60 días', s:'crit'}
];

const agentes = [
  {n:'ATLAS', lead:true, txt:'Orquesta: atiende WhatsApp de clientes, encargados y Dirección; enruta, registra y escala.', hoy:'38 mensajes', dec:'—', canal:'WhatsApp · portal'},
  {n:'ECO', txt:'Lee Gmail, resume y extrae nombre, empresa, email y teléfono; crea la ficha y avisa por WhatsApp.', hoy:'3 clientes · 1 ignorado', dec:'Comercial valida', canal:'Gmail → WhatsApp'},
  {n:'DÉDALO', txt:'Propone presupuestos con partidas del catálogo a partir de fotos y mediciones.', hoy:'1 propuesta', dec:'Técnico y Dirección', canal:'App'},
  {n:'KAIRÓS', txt:'Planning de obras, cuadrillas y medios; avisa de solapes y alquileres que vencen.', hoy:'4 planes enviados', dec:'Jefe de obra', canal:'App · WhatsApp'},
  {n:'HEFESTO', txt:'Imputa partes, albaranes y tickets por obra, periodo y partida; avisa de desviaciones.', hoy:'11 costes · 2 alertas', dec:'Administración', canal:'WhatsApp · app'},
  {n:'EUNOMÍA', txt:'Facturas y certificaciones, registro encadenado y envío según el modo de facturación.', hoy:'1 lista para emitir', dec:'Administración emite', canal:'App → AEAT'},
  {n:'PLUTO', txt:'Cierre mensual, cobros pendientes, márgenes y tesorería.', hoy:'1 aviso de cobro', dec:'Dirección cierra', canal:'App · WhatsApp'}
];

/* ---------- piezas ---------- */
const pill = (txt, cls) => `<span class="pill ${cls||''}">${esc(txt)}</span>`;
const prog = (v, cls) => `<div class="prog"><div class="track"><div class="fill ${cls||''}" style="width:${Math.max(0,Math.min(100,v))}%"></div></div><span class="num">${Math.round(v)} %</span></div>`;
const panel = (title, body, meta, flush) => `<section class="panel"><header><h2>${title}</h2>${meta?`<div class="meta">${meta}</div>`:''}</header><div class="body ${flush?'flush':''}">${body}</div></section>`;
const urgCls = u => u==='alta'?'crit':u==='media'?'warn':'';
function toast(msg){ const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(()=>{ t.hidden = true; }, 3400); }

const views = {};
views['mission-control'] = () => {
  const rows = obras.map(o => { const h = health(o); return `<tr>
    <td><span class="mono small muted">${o.id}</span><div><b>${esc(o.cliente)}</b></div><div class="muted small">${esc(o.trabajo)} · ${esc(o.lugar)}</div></td>
    <td>${esc(o.fase)}</td><td>${prog(o.avance)}</td>
    <td class="n">${eur.format(o.real)}<div class="muted small">prev. ${eur.format(o.prev)}</div></td>
    <td>${pill(healthLabel[h], h)}</td></tr>`; }).join('');
  return `
  <div class="kpis">
    <div class="kpi"><span class="l">Obras activas</span><span class="v">5</span><span class="d">1 en riesgo · 1 parada</span></div>
    <div class="kpi"><span class="l">Presupuestos abiertos</span><span class="v">3</span><span class="d">${eur.format(60600)} enviados + 1 por aprobar</span></div>
    <div class="kpi"><span class="l">Facturado en noviembre</span><span class="v">${eur.format(54870.6)}</span><span class="d">3 facturas · ${VF[state.vfMode].short}</span></div>
    <div class="kpi"><span class="l">Pendiente de cobro</span><span class="v">${eur.format(41870)}</span><span class="d">${eur.format(6420)} con más de 60 días</span></div>
  </div>
  <div class="grid g-3-1">
    ${panel('Obras en curso', `<div class="tbl-wrap"><table><thead><tr><th>Obra</th><th>Fase</th><th>Avance</th><th class="n">Coste real</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></div>`, `<span class="agent">ATLAS</span> actualizado 12:30`, true)}
    ${panel('Actividad de los agentes · hoy', `<ul class="feed">${feed.map(f=>`<li><time>${f.t}</time><span class="agent-col"><span class="agent">${f.a}</span></span><span>${f.lvl?pill(f.lvl==='crit'?'Alerta':'Aviso', f.lvl)+' ':''}${esc(f.s)}</span></li>`).join('')}</ul>`, '', true)}
  </div>
  <div class="grid g-2">
    ${panel('Plan de hoy · lunes 23 nov', `<ul class="steps">
      <li><span class="st done"></span><span><b>Equipo A</b> · OB-26-031 Miramar · encamisado de pilares P-3 y P-4</span><span class="muted small">07:30</span></li>
      <li><span class="st done"></span><span><b>Equipo C</b> · OB-26-034 Cala Blava · montaje Mecanoviga, viguetas 1–6</span><span class="muted small">08:00</span></li>
      <li><span class="st now"></span><span><b>Equipo B</b> · OB-26-036 Son Verí · segunda mano de anticarbonatación</span><span class="muted small">en curso</span></li>
      <li><span class="st"></span><span><b>Técnico</b> · visita de diagnóstico en Av. Argentina 41 (Palma)</span><span class="muted small">17:00</span></li></ul>`, '<span class="agent">KAIRÓS</span>')}
    ${panel('Pendiente de decisión de Dirección', `<ul class="steps">
      <li><span class="st now"></span><span>Aprobar el presupuesto <b>P-26-112</b> · CP Edificio Neptuno</span><a class="btn" href="#presupuestos">Revisar</a></li>
      <li><span class="st now"></span><span>Emitir la <b>certificación nº 3</b> · OB-26-031</span><a class="btn" href="#facturacion">Emitir</a></li>
      <li><span class="st now"></span><span>Revisar la desviación de <b>OB-26-034</b></span><a class="btn" href="#costes">Ver costes</a></li></ul>`)}
  </div>`;
};

views['crm'] = () => `
  ${panel('Embudo de oportunidades', `<div class="kanban">${pipeline.map(c=>`<div class="col"><h3><span>${c.etapa}</span><span class="num">${c.deals.length}</span></h3>${c.deals.map(d=>`<article class="deal"><b>${esc(d.t)}</b><span class="who">${esc(d.who)}</span><div class="row">${pill(d.ch)}${d.urg?pill('Urgencia '+d.urg, urgCls(d.urg)):''}${d.iee?pill('IEE','info'):''}</div></article>`).join('')}</div>`).join('')}</div>`, 'Nuevo → Contactado → Visita → Presupuesto → Aceptado')}
  <div class="grid g-2">
    ${panel('Inmuebles con alerta IEE', `<div class="tbl-wrap"><table><thead><tr><th>Inmueble</th><th class="n">Año</th><th>Estructura</th><th>IEE</th></tr></thead><tbody>${inmuebles.map(i=>`<tr><td>${esc(i.dir)}</td><td class="n">${i.anio}</td><td>${esc(i.est)}</td><td>${pill(i.iee, i.alerta)}</td></tr>`).join('')}</tbody></table></div>`, 'Edificios de más de 50 años', true)}
    ${panel('Origen de los contactos · noviembre', `<div class="tbl-wrap"><table><thead><tr><th>Canal</th><th class="n">Contactos</th><th class="n">Oportunidades</th><th class="n">Aceptadas</th></tr></thead><tbody>
      <tr><td>WhatsApp (ATLAS)</td><td class="n">14</td><td class="n">6</td><td class="n">1</td></tr>
      <tr><td>Gmail (ECO)</td><td class="n">11</td><td class="n">5</td><td class="n">1</td></tr>
      <tr><td>Formulario web</td><td class="n">4</td><td class="n">2</td><td class="n">0</td></tr>
      <tr><td>Teléfono y recomendación</td><td class="n">6</td><td class="n">3</td><td class="n">1</td></tr></tbody></table></div>`, 'Deduplicado por email y teléfono', true)}
  </div>`;

views['bandeja'] = () => {
  const m = mensajes[state.msg], x = m.x;
  const list = mensajes.map((mm,i)=>`<button class="msg" type="button" role="option" aria-selected="${i===state.msg}" data-msg="${i}">
      <span class="ch ${mm.ch}">${mm.ch==='wa'?'WhatsApp':'Gmail'}</span>
      <span style="min-width:0"><span class="subj">${esc(mm.subj)}</span><br><span class="prev">${esc(mm.prev)}</span></span>
      <time>${mm.t}</time></button>`).join('');
  let detail;
  if (x.cliente) {
    const wa = `NUEVO ${m.ch==='wa'?'WHATSAPP':'CORREO'} DE CLIENTE · R4\nNombre: ${x.nombre}\nEmpresa: ${x.empresa}\nEmail: ${x.email}\nTeléfono: ${x.tel}\nResumen: ${x.resumen}\nServicio: ${x.servicio} · Urgencia: ${x.urg}`;
    detail = `<dl class="fields">
        <dt>Nombre</dt><dd>${esc(x.nombre)}</dd>
        <dt>Empresa</dt><dd>${esc(x.empresa)}</dd>
        <dt>Email</dt><dd class="mono small">${esc(x.email)}</dd>
        <dt>Teléfono</dt><dd class="mono small">${esc(x.tel)}</dd>
        <dt>Servicio</dt><dd>${esc(x.servicio)}</dd>
        <dt>Urgencia</dt><dd>${pill(x.urg, urgCls(x.urg))}</dd>
        <dt>Resumen</dt><dd>${esc(x.resumen)}</dd>
      </dl>
      <div style="display:grid;gap:8px;margin-top:16px"><span class="small muted">Aviso enviado al agente de WhatsApp</span><div class="wa-preview">${esc(wa)}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn primary" type="button" data-act="wa">Reenviar a WhatsApp</button><a class="btn" href="#crm">Abrir ficha</a><button class="btn" type="button" data-act="corregir">Corregir datos</button></div>`;
  } else {
    detail = `<div class="callout">ECO ha marcado este correo como <b>no cliente</b> (boletín o aviso automático). No crea ficha ni envía WhatsApp; queda con la etiqueta R4/Ignorado.</div><div style="margin-top:12px"><button class="btn" type="button" data-act="esCliente">Es un cliente: procesar</button></div>`;
  }
  return `<div class="grid g-1-2">
    ${panel('Entrada · hoy', `<div role="listbox" aria-label="Mensajes recibidos">${list}</div>`, '<span class="agent">ECO</span><span class="agent">ATLAS</span>', true)}
    ${panel('Extracción de ECO', detail, pill(x.estado, x.cliente?'ok':''))}
  </div>`;
};
views['presupuestos'] = () => {
  const sub = lineas.reduce((s,l)=>s+l.q*l.p,0);
  const ivaR = {red:0.10, gen:0.21, isp:0}[state.iva];
  const iva = sub * ivaR, tot = sub + iva, coste = sub * 0.76;
  const ivaTxt = state.iva==='red' ? 'Reparación de vivienda para comunidad o particular; se comprueba que los materiales no superen el 40 % de la base.' : state.iva==='isp' ? 'R4 trabaja para una constructora: factura sin IVA con la mención de inversión del sujeto pasivo.' : 'Tipo general para locales, hoteles y promotoras.';
  const rows = lineas.map(l=>`<tr><td><span class="mono small">${l.cod}</span></td><td>${esc(l.d)}</td><td>${l.u}</td><td class="n">${l.q.toLocaleString('es-ES')}</td><td class="n">${eur2.format(l.p)}</td><td class="n"><b>${eur2.format(l.q*l.p)}</b></td></tr>`).join('');
  return `<div class="grid g-3-1">
    ${panel('P-26-112 · CP Edificio Neptuno · aluminosis en forjado', `
      <div class="callout" style="margin:16px 18px 0"><span class="agent">DÉDALO</span> Propuesta a partir de 18 fotos y las mediciones de la visita del 21 nov. El técnico ha ajustado 2 cantidades.</div>
      <div class="tbl-wrap" style="margin-top:14px"><table><thead><tr><th>Partida</th><th>Descripción</th><th>Ud</th><th class="n">Cantidad</th><th class="n">Precio</th><th class="n">Importe</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div style="padding:16px 18px;display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start">
        <div style="display:grid;gap:8px;min-width:0;flex:1 1 280px">
          <span class="small muted">Tipo de IVA</span>
          <div class="seg" role="group" aria-label="Tipo de IVA">
            <button type="button" data-iva="red" aria-pressed="${state.iva==='red'}">10 % vivienda</button>
            <button type="button" data-iva="gen" aria-pressed="${state.iva==='gen'}">21 % general</button>
            <button type="button" data-iva="isp" aria-pressed="${state.iva==='isp'}">ISP subcontrata</button>
          </div>
          <span class="small muted" style="max-width:380px">${ivaTxt}</span>
        </div>
        <div class="totals">
          <span>Base imponible</span><span class="num">${eur2.format(sub)}</span>
          <span>IVA ${state.iva==='isp'?'(ISP)':Math.round(ivaR*100)+' %'}</span><span class="num">${eur2.format(iva)}</span>
          <span class="grand">Total</span><span class="grand num">${eur2.format(tot)}</span>
          <span class="muted small">Margen estimado</span><span class="muted small num">${pct((sub-coste)*100/sub)}</span>
        </div>
      </div>
      <div style="padding:0 18px 18px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" type="button" data-act="aprobar">Aprobar y enviar al cliente</button><button class="btn" type="button" data-act="version">Guardar como versión 2</button></div>`,
      pill('Pendiente de Dirección','warn'), true)}
    ${panel('Presupuestos', `<div class="tbl-wrap"><table><tbody>${presupuestos.map((p,i)=>`<tr class="${i===0?'sel':''}"><td><span class="mono small muted">${p.n}</span><div><b>${esc(p.cliente)}</b></div><div class="muted small">${esc(p.trabajo)}</div></td><td class="n">${eur.format(p.imp||sub)}<div style="margin-top:4px">${pill(p.estado,p.s)}</div></td></tr>`).join('')}</tbody></table></div>`, 'Catálogo R4 · 31 partidas', true)}
  </div>`;
};

views['obras'] = () => {
  const o = obras[0];
  return `<div class="grid g-1-2">
    ${panel(`${o.id} · ${esc(o.cliente)}`, `
      <dl class="fields"><dt>Trabajo</dt><dd>${esc(o.trabajo)}</dd><dt>Ubicación</dt><dd>${esc(o.lugar)} (Mallorca)</dd><dt>Avance</dt><dd>${prog(o.avance,'ok')}</dd><dt>Presupuesto</dt><dd class="num">${eur.format(o.pres)}</dd><dt>Fin previsto</dt><dd>${o.fin}</dd><dt>Periodo de control</dt><dd>Semanal</dd></dl>
      <h3 class="subhead">Fases</h3>
      <ul class="steps">${fases.map(f=>`<li><span class="st ${f.s}"></span><span>${esc(f.n)}</span><span class="muted small">${f.f}</span></li>`).join('')}</ul>`, pill('En plan','ok'))}
    ${panel('Diario fotográfico', `<div class="photos">${diario.map(d=>`<figure class="ph"><div class="img" role="img" aria-label="Foto de obra de ejemplo: ${esc(d.c)}"><span>${d.f}</span></div><figcaption>${esc(d.c)}</figcaption></figure>`).join('')}</div>
      <p class="note" style="margin-top:12px">Aquí aparecen, fechadas, las fotos que el encargado envía cada día por WhatsApp. El cliente las ve en su portal si Dirección lo activa.</p>`, '<span class="agent">ATLAS</span> 46 fotos')}
  </div>`;
};

views['planning'] = () => {
  const cell = c => c===null ? `<div><div class="job free">Sin asignar</div></div>` : c==='vis' ? `<div><div class="job o5"><b>VISITA</b>Diagnóstico</div></div>` : `<div><div class="job ${c}"><b>${obraName[c][0]}</b>${obraName[c][1]}</div></div>`;
  const grid = `<div class="tbl-wrap"><div class="plan"><div class="h">Cuadrilla</div>${dias.map((d,i)=>`<div class="h ${i===0?'today':''}">${d}${i===0?' · hoy':''}</div>`).join('')}${equipos.map(e=>`<div class="team">${e.n}<small>${e.r}</small></div>${e.d.map(cell).join('')}`).join('')}</div></div>`;
  return `${panel('Semana 48 · 23–27 nov', grid, '<span class="agent">KAIRÓS</span> Equipo B libre el jueves 26', true)}
  <div class="grid g-2">
    ${panel('Medios y alquileres', `<div class="tbl-wrap"><table><thead><tr><th>Medio</th><th>Obra</th><th>Hasta</th><th>Estado</th></tr></thead><tbody>
      <tr><td>120 puntales metálicos</td><td class="mono small">OB-26-034</td><td>15 dic</td><td>${pill('En uso','ok')}</td></tr>
      <tr><td>40 puntales metálicos</td><td class="mono small">OB-26-029</td><td>Abierto</td><td>${pill('Obra parada','warn')}</td></tr>
      <tr><td>Andamio de fachada, 180 m²</td><td class="mono small">OB-26-036</td><td>28 nov</td><td>${pill('Devolver el viernes','info')}</td></tr>
      <tr><td>Equipo de hormigón proyectado</td><td>Almacén</td><td>—</td><td>${pill('Libre')}</td></tr></tbody></table></div>`, '', true)}
    ${panel('Mensaje de las 7:00 al encargado', `<div class="wa-preview">PLAN DE HOY · LUN 23 NOV
Obra: OB-26-031 Edificio Miramar (s'Arenal)
Equipo A: oficial + 2 peones
Tareas: encamisado de pilares P-3 y P-4; empresillado de P-5
Material en obra: angulares y pletinas (albarán 2291)
Al terminar responde con: horas, avance y fotos.</div>`, '<span class="agent">KAIRÓS</span>')}
  </div>`;
};
views['costes'] = () => {
  const rows = costes[state.period];
  const tot = q => q.mo + q.mat + q.med + q.sub + q.gen;
  const max = Math.max(...rows.map(q => Math.max(tot(q), q.prev)));
  const sumR = rows.reduce((s,q)=>s+tot(q),0), sumP = rows.reduce((s,q)=>s+q.prev,0);
  const seg = (v, c) => v ? `<i style="width:${v*100/max}%;background:var(${c})" title="${eur.format(v)}"></i>` : '';
  const body = rows.map(q => { const t = tot(q), d = (t - q.prev) * 100 / q.prev; return `<tr>
    <td><b>${q.p}</b></td>
    <td><div class="cbar" aria-hidden="true">${seg(q.mo,'--o1')}${seg(q.mat,'--o3')}${seg(q.med,'--o2')}${seg(q.sub,'--o4')}${seg(q.gen,'--o5')}</div></td>
    <td class="n">${eur.format(q.mo)}</td><td class="n">${eur.format(q.mat)}</td><td class="n">${eur.format(q.med)}</td><td class="n">${eur.format(q.sub)}</td><td class="n">${eur.format(q.gen)}</td>
    <td class="n"><b>${eur.format(t)}</b></td><td class="n">${eur.format(q.prev)}</td><td class="n">${pill((d>0?'+':'')+pct(d), d>20?'crit':d>2?'warn':'ok')}</td></tr>`; }).join('');
  return `
  <div class="kpis">
    <div class="kpi"><span class="l">Coste real acumulado</span><span class="v">${eur.format(sumR)}</span><span class="d">OB-26-034 · Hotel Cala Blava</span></div>
    <div class="kpi"><span class="l">Previsto a la fecha</span><span class="v">${eur.format(sumP)}</span><span class="d">Según el presupuesto aceptado</span></div>
    <div class="kpi"><span class="l">Desviación</span><span class="v" style="color:var(--crit)">+${pct((sumR-sumP)*100/sumP)}</span><span class="d">Sobre lo previsto a la fecha</span></div>
    <div class="kpi"><span class="l">Avance certificado</span><span class="v">18 %</span><span class="d">Coste consumido: ${pct(sumR*100/86200)} del total</span></div>
  </div>
  ${panel('Coste por rango de tiempo', `
    <div style="padding:14px 18px;display:flex;gap:16px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)">
      <div class="seg" role="group" aria-label="Periodo de control">
        <button type="button" data-period="semana" aria-pressed="${state.period==='semana'}">Semana</button>
        <button type="button" data-period="quincena" aria-pressed="${state.period==='quincena'}">Quincena</button>
        <button type="button" data-period="mes" aria-pressed="${state.period==='mes'}">Mes</button>
      </div>
      <div class="legend"><span><i style="background:var(--o1)"></i>Mano de obra</span><span><i style="background:var(--o3)"></i>Materiales</span><span><i style="background:var(--o2)"></i>Medios y alquileres</span><span><i style="background:var(--o4)"></i>Subcontratas</span><span><i style="background:var(--o5)"></i>Generales</span></div>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>Periodo</th><th>Reparto</th><th class="n">Mano de obra</th><th class="n">Materiales</th><th class="n">Medios</th><th class="n">Subcontr.</th><th class="n">Generales</th><th class="n">Real</th><th class="n">Previsto</th><th class="n">Desviación</th></tr></thead><tbody>${body}</tbody></table></div>`,
    '<span class="agent">HEFESTO</span> obra × periodo × partida', true)}
  <div class="grid g-2">
    ${panel('Tarifas por tramo horario · €/h', `<div class="tbl-wrap"><table><thead><tr><th>Categoría</th><th class="n">Ordinaria</th><th class="n">Extra</th><th class="n">Festivo</th></tr></thead><tbody>${tramos.map(t=>`<tr><td>${t.cat}</td><td class="n">${eur.format(t.ord)}</td><td class="n">${eur.format(t.ext)}</td><td class="n">${eur.format(t.fes)}</td></tr>`).join('')}</tbody></table></div>`, 'Tarifas de ejemplo', true)}
    ${panel('Por qué se desvía OB-26-034', `<ul class="steps">
      <li><span class="st now"></span><span><b>Puntales:</b> 120 uds alquiladas desde el 26 oct; el presupuesto preveía montarlas el 9 nov.</span><span class="num small">+${eur.format(2660)}</span></li>
      <li><span class="st now"></span><span><b>Mano de obra:</b> 46 h extra en S45 por el retraso del material Mecanoviga.</span><span class="num small">+${eur.format(1650)}</span></li>
      <li><span class="st now"></span><span><b>Cálculo:</b> el estudio de ingeniería se facturó en S44, antes de lo previsto.</span><span class="num small">+${eur.format(950)}</span></li></ul>
      <p class="note" style="margin-top:10px">HEFESTO avisó a Dirección por WhatsApp el 9 nov y hoy a las 09:40.</p>`)}
  </div>`;
};
function qrHTML(seed){
  let s = seed, cells = '';
  const dark = () => { s = (s * 9301 + 49297) % 233280; return s > 111974; };
  const finder = (i,j) => { let f = null; [[0,0],[0,14],[14,0]].forEach(([i0,j0]) => { if (i>=i0 && i<i0+7 && j>=j0 && j<j0+7){ const a=i-i0, b=j-j0; f = (a===0||a===6||b===0||b===6||(a>=2&&a<=4&&b>=2&&b<=4)); } }); return f; };
  for (let i=0;i<21;i++) for (let j=0;j<21;j++){ const f = finder(i,j); const on = f===null ? dark() : f; cells += `<i class="${on?'b':''}"></i>`; }
  return `<div class="qr" role="img" aria-label="Código QR de ejemplo">${cells}</div>`;
}

views['facturacion'] = () => {
  const m = VF[state.vfMode];
  const rows = facturas.map(f => { const iva = f.base * f.iva; return `<tr>
    <td><span class="mono small">${f.n}</span><div class="muted small">${f.f}</div></td>
    <td><b>${esc(f.cli)}</b><div class="muted small">${esc(f.con)}</div></td>
    <td class="n">${eur2.format(f.base)}</td><td class="n">${f.tipo==='ISP'?'ISP':eur2.format(iva)}</td><td class="n"><b>${eur2.format(f.base+iva)}</b></td>
    <td>${pill(f.cobro, f.s)}</td><td>${pill(m.reg, m.badge)}</td></tr>`; }).join('');
  const modoTxt = state.vfMode==='verifactu' ? 'Cada factura se envía a la AEAT al emitirse. El QR lleva la mención VERI*FACTU y el cliente puede comprobar la factura en la sede de la AEAT.' : state.vfMode==='noverifactu' ? 'Las facturas no se envían en el momento: cada registro se firma con el certificado de R4, se encadena y se guarda junto al registro de eventos, listo si la AEAT lo pide.' : 'R4 lleva el Suministro Inmediato de Información: queda fuera de Verifactu y EUNOMÍA exporta los libros al SII.';
  const sello = state.vfMode==='verifactu' ? 'VERI*FACTU · factura verificable en la sede electrónica de la AEAT' : state.vfMode==='noverifactu' ? 'QR de la factura' : 'Factura registrada en el SII';
  const extra = state.vfMode==='noverifactu' ? '<dt>Firma</dt><dd class="small">XAdES · certificado de R4</dd><dt>Eventos</dt><dd class="small">Registro de eventos activo</dd>' : '';
  return `<div class="grid g-3-1">
    ${panel('Facturas emitidas', `<div class="tbl-wrap"><table><thead><tr><th>Número</th><th>Cliente y concepto</th><th class="n">Base</th><th class="n">IVA</th><th class="n">Total</th><th>Cobro</th><th>Registro fiscal</th></tr></thead><tbody>${rows}</tbody></table></div>`, `${pill(m.label, m.badge)} <a class="btn" href="#configuracion">Cambiar modo</a>`, true)}
    ${panel('Registro de la última factura', `<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">${qrHTML(141)}<div style="display:grid;gap:6px;min-width:0;flex:1 1 140px"><b class="mono">F-2026-0141</b><span class="small">${sello}</span><span>${pill(m.reg, m.badge)}</span></div></div>
      <dl class="fields" style="margin-top:14px;grid-template-columns:90px minmax(0,1fr)"><dt>Huella</dt><dd class="hash">9f3c…a71e2b08d4c5e19f7a2c6b3d0e8f4a51</dd><dt>Anterior</dt><dd class="hash">F-2026-0140 · 2b7e…c0d91f</dd>${extra}</dl>
      <p class="note" style="margin-top:12px">${modoTxt}</p>`, '<span class="agent">EUNOMÍA</span>')}
  </div>
  ${panel('Lista para emitir', `<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center"><span style="min-width:0;flex:1 1 280px"><b>Certificación nº 3 · OB-26-031 CP Edificio Miramar</b><br><span class="muted small">Base ${eur2.format(9720)} · IVA 10 % · retención de garantía del 5 % (${eur2.format(486)}) hasta la recepción</span></span><button class="btn primary" type="button" data-act="emitir">Emitir certificación</button></div>`)}`;
};
views['finanzas'] = () => {
  const aging = [{l:'0–30 días', v:23580, c:'--good'},{l:'31–60 días', v:11870, c:'--warn'},{l:'61–90 días', v:6420, c:'--crit'},{l:'Más de 90', v:0, c:'--crit'}];
  const tot = aging.reduce((s,a)=>s+a.v,0);
  const margen = [
    {o:'OB-26-031', c:'CP Edificio Miramar', p:48600, f:36900, obj:24},
    {o:'OB-26-034', c:'Hotel Cala Blava', p:86200, f:74100, obj:22},
    {o:'OB-26-036', c:'AF Son Verí', p:22400, f:17900, obj:20},
    {o:'OB-26-038', c:'Promociones Llevant', p:64900, f:49300, obj:24},
    {o:'OB-26-029', c:'Particular · Inca', p:9800, f:8900, obj:15}];
  const tes = [62,58,71,66,54,49,63,70,65,59,74,68,72];
  const W = 640, H = 170, pad = 30, bw = (W - pad*2) * (1 / tes.length), mx = 80;
  const yy = v => H - 24 - v*(H-48)*(1 / mx);
  const bars = tes.map((v,i)=>`<rect x="${pad + i*bw + 4}" y="${yy(v)}" width="${bw-8}" height="${H-24-yy(v)}" rx="3" style="fill:var(${i===5?'--warn':'--fg-3'})"><title>Semana ${48+i}: ${v} mil €</title></rect>`).join('');
  const grid = [0,40,80].map(g=>`<line x1="${pad}" x2="${W-pad}" y1="${yy(g)}" y2="${yy(g)}" style="stroke:var(--line)"></line><text x="${pad-6}" y="${yy(g)+4}" text-anchor="end" font-size="11" style="fill:var(--fg-2)">${g}k</text>`).join('');
  const mg = m => (m.p-m.f)*100*(1 / m.p);
  return `
  <div class="kpis">
    <div class="kpi"><span class="l">Facturado · nov</span><span class="v">${eur.format(54870.6)}</span><span class="d">Octubre: ${eur.format(48210)}</span></div>
    <div class="kpi"><span class="l">Cobrado · nov</span><span class="v">${eur.format(41850.6)}</span><span class="d">2 cobros</span></div>
    <div class="kpi"><span class="l">Coste de obras · nov</span><span class="v">${eur.format(38420)}</span><span class="d">5 obras · desde Costes</span></div>
    <div class="kpi"><span class="l">Pendiente de certificar</span><span class="v">${eur.format(9720)}</span><span class="d">Obra ejecutada sin facturar</span></div>
  </div>
  <div class="grid g-2">
    ${panel('Pendiente de cobro por antigüedad', `<div style="display:grid;gap:12px">${aging.map(a=>`<div style="display:grid;grid-template-columns:90px minmax(0,1fr) 84px;gap:10px;align-items:center"><span class="small">${a.l}</span><div class="cbar" style="height:14px;min-width:0"><i style="width:${a.v*100*(1 / tot)}%;background:var(${a.c})"></i></div><span class="num small" style="text-align:right">${eur.format(a.v)}</span></div>`).join('')}<div style="display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:10px"><b>Total</b><b class="num">${eur.format(tot)}</b></div></div>`, '<span class="agent">PLUTO</span>')}
    ${panel('Tesorería prevista · 13 semanas', `<div class="tbl-wrap"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Saldo previsto por semana, entre 49 y 74 mil euros" style="display:block;min-width:420px">${grid}${bars}<text x="${pad+bw*0.5}" y="${H-6}" text-anchor="middle" font-size="11" style="fill:var(--fg-2)">S48</text><text x="${pad+12.5*bw}" y="${H-6}" text-anchor="middle" font-size="11" style="fill:var(--fg-2)">S60</text><text x="${pad+5.5*bw}" y="${yy(49)-6}" text-anchor="middle" font-size="11" font-weight="600" style="fill:var(--warn)">49k</text></svg></div><p class="note">Punto más bajo en la semana 53: pagos de proveedores y nóminas de diciembre antes de cobrar las certificaciones.</p>`, 'Miles de €')}
  </div>
  <div class="grid g-3-1">
    ${panel('Margen por obra', `<div class="tbl-wrap"><table><thead><tr><th>Obra</th><th class="n">Presupuesto</th><th class="n">Coste previsto final</th><th class="n">Margen previsto</th><th class="n">Objetivo</th></tr></thead><tbody>${margen.map(m=>`<tr><td><span class="mono small muted">${m.o}</span><div>${esc(m.c)}</div></td><td class="n">${eur.format(m.p)}</td><td class="n">${eur.format(m.f)}</td><td class="n">${pill(pct(mg(m)), mg(m) < m.obj-5 ? 'crit' : mg(m) < m.obj ? 'warn' : 'ok')}</td><td class="n muted">${m.obj} %</td></tr>`).join('')}</tbody></table></div>`, '', true)}
    ${panel('Cierre de noviembre', `<ul class="steps">
      <li><span class="st now"></span><span><b>PLUTO prepara el cierre</b><br><span class="muted small">1 dic, automático</span></span><span></span></li>
      <li><span class="st"></span><span><b>Administración revisa</b><br><span class="muted small">Costes, cobros e IVA del trimestre</span></span><span></span></li>
      <li><span class="st"></span><span><b>Dirección cierra el mes</b><br><span class="muted small">Antes del 5 dic; el mes queda bloqueado</span></span><span></span></li></ul>
      <p class="note" style="margin-top:8px">Octubre lo cerró Dirección el 4 nov.</p>`)}
  </div>`;
};
views['atlas'] = () => `
  <div class="agents">${agentes.map(a=>`<article class="agent-card ${a.lead?'lead':''}"><h3><span class="dot" aria-hidden="true"></span>${a.n}</h3><p>${esc(a.txt)}</p><div class="stat"><span>Hoy</span><b>${esc(a.hoy)}</b></div><div class="stat"><span>Canal</span><span>${esc(a.canal)}</span></div><div class="stat"><span>Decide</span><span>${esc(a.dec)}</span></div></article>`).join('')}</div>
  ${panel('Reglas de ATLAS', `<ul class="steps">
    <li><span class="st done"></span><span>La IA prepara, resume y propone; una persona de R4 aprueba presupuestos, emite facturas y cierra el mes.</span><span></span></li>
    <li><span class="st done"></span><span>EUNOMÍA no usa IA en el registro fiscal: numeración, impuestos y envío son deterministas.</span><span></span></li>
    <li><span class="st done"></span><span>Todo lo que entra por WhatsApp o Gmail queda en la ficha del cliente o de la obra.</span><span></span></li>
    <li><span class="st done"></span><span>Escala a Dirección por WhatsApp cuando un cliente lo pide o un agente no está seguro.</span><span></span></li></ul>`)}`;

const modos = [
  ['verifactu','Con VERI*FACTU','Envío automático de cada factura a la AEAT. Sin firma de registros y sin registro de eventos.'],
  ['noverifactu','Sin VERI*FACTU','Registros firmados con el certificado de R4, encadenados y guardados, con registro de eventos.'],
  ['sii','SII','Si R4 lleva el Suministro Inmediato de Información, queda fuera de Verifactu.']
];
views['configuracion'] = () => `
  ${configLiveTop()}
  ${panel('Modo de facturación', `
    <div class="modes" role="radiogroup" aria-label="Modo de facturación">
      ${modos.map(([v,t,d])=>`<label class="mode" for="vf-${v}"><input type="radio" name="vfmode" id="vf-${v}" value="${v}" ${state.vfMode===v?'checked':''}><span class="chk" aria-hidden="true"></span><b>${t}</b><p>${d}</p></label>`).join('')}
    </div>
    <p class="note" style="margin-top:12px">Obligatorio desde el 1 ene 2027 para sociedades y el 1 jul 2027 para autónomos según el BOE vigente; Hacienda anunció un aplazamiento a 2028 aún sin publicar. El cambio de modo se aplica desde el siguiente año natural (a confirmar con la asesoría fiscal).</p>`, '<span class="agent">EUNOMÍA</span>')}
  <div class="grid g-2">
    ${panel('Datos de la empresa', `<dl class="fields">
      <dt>Nombre comercial</dt><dd>R4 Rehabilitación de Estructuras</dd>
      <dt>Razón social</dt><dd>${pill('Pendiente','warn')}</dd>
      <dt>CIF</dt><dd>${pill('Pendiente','warn')}</dd>
      <dt>Domicilio</dt><dd>Carrer Bellavista-C 14, Urb. Bellavista Arenal, 07600 Arenal (Mallorca)</dd>
      <dt>Email</dt><dd class="mono small">proyectos@r4estructuras.com</dd>
      <dt>Teléfonos</dt><dd class="mono small">+34 655 915 236 · 971 29 07 86</dd>
      <dt>Certificado</dt><dd>${pill('Pendiente de subir','warn')}</dd></dl>`, 'Desde r4estructuras.com')}
    ${integracionesPanel()}
  </div>
  ${panel('Roles', `<div class="tbl-wrap"><table><thead><tr><th>Rol</th><th>Acceso</th><th>Canal</th></tr></thead><tbody>
    <tr><td><b>Dirección</b></td><td>Todo; aprueba presupuestos y cierra el mes</td><td>App · WhatsApp</td></tr>
    <tr><td><b>Técnico / jefe de obra</b></td><td>CRM, presupuestos, obras y planning</td><td>App · WhatsApp</td></tr>
    <tr><td><b>Encargado de obra</b></td><td>Sus obras: parte diario y fotos</td><td>WhatsApp</td></tr>
    <tr><td><b>Administración</b></td><td>Costes, facturación y cierre</td><td>App</td></tr>
    <tr><td><b>Comercial / atención</b></td><td>CRM y borradores de presupuesto</td><td>App</td></tr>
    <tr><td><b>Colaborador externo</b></td><td>Obras asignadas: cálculos e informes</td><td>Portal</td></tr>
    <tr><td><b>Cliente</b></td><td>Su presupuesto, firma, diario y facturas</td><td>Portal · WhatsApp</td></tr></tbody></table></div>`, '', true)}`;

/* =====================================================================
   CAPA EN VIVO · v1.2 HOLOCONTROL
   Sesión: /api/session  ·  Datos y acciones: /api/r4  (Vercel → n8n «R4 · API» → Postgres)
   Sin sesión, las secciones vivas usan DEMO, con la misma forma que r4_summary().
   ===================================================================== */
const LIVE_SECTIONS = new Set(['mission-control','crm','bandeja','atlas','configuracion']);
const live = { configured:null, noBackend:false, authed:false, data:null, loading:false, error:null, at:null, msgId:null, editing:false, busy:false, editInm:null, crmTab:'contactos', cliId:null, q:'' };
const ETAPAS = [['nuevo','Nuevo'],['contactado','Contactado'],['visita','Visita'],['presupuesto','Presupuesto'],['aceptado','Aceptado']];
const ETAPA_LARGA = { nuevo:'Nuevo', contactado:'Contactado', visita:'Visita de diagnóstico', presupuesto:'Presupuesto enviado', aceptado:'Aceptado', perdido:'Perdido' };
const CAMPOS = [['nombre','Nombre'],['empresa','Empresa'],['email','Email'],['telefono','Teléfono'],['servicio','Servicio'],['urgencia','Urgencia'],['solicita','Solicita'],['tipo_cliente','Tipo de cliente'],['direccion_obra','Dirección de la obra'],['municipio','Municipio'],['titulo','Asunto'],['resumen','Resumen']];
const ETQ = Object.fromEntries(CAMPOS);
const EDITABLES = ['nombre','empresa','email','telefono','servicio','urgencia','direccion_obra','municipio','resumen'];
const ESTADOS = { recibido:['ECO procesando',''], procesado:['Procesado · sin aviso WhatsApp','info'], ignorado:['Ignorado · no es cliente',''], enviado_wa:['Enviado a WhatsApp','ok'], error_wa:['Error al enviar WhatsApp','crit'] };
const TIPOS = { comunidad:'Comunidad de propietarios', administrador_fincas:'Administrador de fincas', particular:'Particular', empresa:'Empresa', hotel:'Hotel', promotora:'Promotora', constructora:'Constructora', arquitecto_ingenieria:'Arquitectura o ingeniería', administracion_publica:'Administración pública', otro:'Otro' };
const TZ = 'Europe/Madrid';
const e2 = v => esc(v == null ? '' : v);
const fmtHora = d => d ? new Date(d).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit',timeZone:TZ}) : '—';
const dayKey = d => new Date(d).toLocaleDateString('es-ES',{timeZone:TZ});
const fmtFecha = d => !d ? '—' : (dayKey(d) === dayKey(Date.now()) ? fmtHora(d) : new Date(d).toLocaleDateString('es-ES',{day:'numeric',month:'short',timeZone:TZ}) + ' ' + fmtHora(d));
const isLive = () => live.authed && !!live.data;
const srcTag = on => on ? '<span class="src live">En vivo</span>' : '<span class="src demo">Demostración</span>';
const iniciales = n => String(n || '?').replace(/^(CP|AF)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

/* ---------- DEMO: misma forma que r4_summary() ---------- */
const T0 = Date.now(), ago = m => new Date(T0 - m * 60000).toISOString();
const DEMO = {
  kpis: { mensajes_hoy: 5, clientes_hoy: 3, ignorados_hoy: 1, wa_hoy: 2, errores_wa: 1, clientes_total: 5, clientes_7d: 4, oportunidades_abiertas: 5, organizaciones: 4, alertas_iee: 2 },
  canales: { ultimo_gmail: ago(12), ultimo_whatsapp: ago(25), ultimo_aviso_wa: ago(12) },
  config: { evolution_url:'https://evolution.example.test', evolution_instancia:'ATLASR4', wa_destino_direccion:'34600000000', wa_campos:'nombre,empresa,email,telefono,servicio,urgencia,direccion_obra,resumen', eco_activo:'true', gmail_cuenta:'', plataforma_url:'' },
  clientes: [
    {id:1, nombre:'Carmen Vidal', empresa:'Administración de Fincas Portixol', organizacion_tipo:'administrador_fincas', email:'c.vidal@fincas-portixol.example', telefono:'+34600000101', origen:'gmail', base_legal:'medidas_precontractuales', created_at:ago(12)},
    {id:2, nombre:'Miquel Pons', empresa:'Particular', organizacion_tipo:'particular', email:'', telefono:'+34600000202', origen:'whatsapp', base_legal:'medidas_precontractuales', created_at:ago(25)},
    {id:3, nombre:'Antoni Riera', empresa:'CP Son Ferriol', organizacion_tipo:'comunidad', email:'presidencia.sonferriol@correo.example', telefono:'+34600000303', origen:'gmail', base_legal:'medidas_precontractuales', created_at:ago(55)},
    {id:4, nombre:'Laura Ferrer', empresa:'Estudio Ferrer Arquitectura', organizacion_tipo:'arquitecto_ingenieria', email:'laura.ferrer@estudio.example', telefono:'', origen:'gmail', base_legal:'medidas_precontractuales', created_at:ago(60 * 26)},
    {id:5, nombre:'Joan Mas', empresa:'CP Edificio Neptuno', organizacion_tipo:'comunidad', email:'joanmas@correo.example', telefono:'+34611222333', origen:'gmail', base_legal:'medidas_precontractuales', created_at:ago(60 * 50)}
  ],
  oportunidades: [
    {id:1, cliente_id:1, titulo:'Grietas en vigas del garaje', etapa:'nuevo', servicio:'Reparación del hormigón armado', urgencia:'alta', canal:'gmail', municipio:'Palma', inmueble_id:1, created_at:ago(12)},
    {id:2, cliente_id:2, titulo:'Humedad por capilaridad en planta baja', etapa:'nuevo', servicio:'Trabajos auxiliares', urgencia:'media', canal:'whatsapp', municipio:'Llucmajor', created_at:ago(25)},
    {id:3, cliente_id:3, titulo:'Deficiencias IEE en pilares del sótano', etapa:'contactado', servicio:'IEE / ITE', urgencia:'media', canal:'gmail', municipio:'Palma', inmueble_id:2, created_at:ago(55)},
    {id:4, cliente_id:5, titulo:'Aluminosis en forjado', etapa:'visita', servicio:'Reparación del hormigón armado', urgencia:'alta', canal:'gmail', municipio:"s'Arenal", inmueble_id:3, created_at:ago(60 * 50)},
    {id:5, cliente_id:4, titulo:'Refuerzo de pilar para reforma de local', etapa:'presupuesto', servicio:'Refuerzo estructural', urgencia:'baja', canal:'gmail', municipio:'Palma', importe:21700, created_at:ago(60 * 26)}
  ],
  inmuebles: [
    {id:1, direccion:'Av. Argentina 41', municipio:'Palma', anio_construccion:1968, tipo_estructura:'Hormigón armado', iee_fecha:null, organizacion:'Administración de Fincas Portixol', alerta_iee:'sin_iee', oportunidades:1, created_at:ago(12)},
    {id:2, direccion:'C/ Son Ferriol 8', municipio:'Palma', anio_construccion:1975, tipo_estructura:'Viguetas pretensadas', iee_fecha:'2016-03-10', organizacion:'CP Son Ferriol', alerta_iee:'renovar', oportunidades:1, created_at:ago(55)},
    {id:3, direccion:'C/ Neptú 12', municipio:"s'Arenal", anio_construccion:1972, tipo_estructura:'Viguetas pretensadas', iee_fecha:'2019-06-01', organizacion:'CP Edificio Neptuno', alerta_iee:'ok', oportunidades:1, created_at:ago(60 * 50)}
  ],
  mensajes: [
    {id:5, canal:'gmail', asunto:'Solicitud de presupuesto · grietas en vigas del garaje', preview:'Buenos días, somos la administración del edificio de Av. Argentina 41. En la última junta se detectaron grietas en dos vigas del garaje y nos gustaría una visita esta semana…', remitente_nombre:'Carmen Vidal', remitente_email:'c.vidal@fincas-portixol.example', recibido_at:ago(12), estado:'enviado_wa', es_cliente:true, wa_enviado_at:ago(12), cliente_id:1, oportunidad_id:1,
     extraccion:{nombre:'Carmen Vidal', empresa:'Administración de Fincas Portixol', email:'c.vidal@fincas-portixol.example', telefono:'+34600000101', tipo_cliente:'administrador_fincas', servicio:'Reparación del hormigón armado', solicita:'visita', urgencia:'alta', direccion_obra:'Av. Argentina 41', municipio:'Palma', titulo:'Grietas en vigas del garaje', resumen:'Administra la comunidad de Av. Argentina 41 (Palma). Grietas en dos vigas del garaje. Pide visita esta semana y presupuesto para la junta de diciembre.'}},
    {id:4, canal:'whatsapp', asunto:'WhatsApp · Miquel Pons', preview:'Hola, tenemos manchas de humedad que suben por las paredes de la planta baja en una casa de Llucmajor. ¿Hacéis inyecciones?', remitente_nombre:'Miquel Pons', remitente_tel:'+34600000202', recibido_at:ago(25), estado:'procesado', es_cliente:true, cliente_id:2, oportunidad_id:2,
     extraccion:{nombre:'Miquel Pons', empresa:'Particular', telefono:'+34600000202', tipo_cliente:'particular', servicio:'Trabajos auxiliares', solicita:'informacion', urgencia:'media', municipio:'Llucmajor', titulo:'Humedad por capilaridad en planta baja', resumen:'Vivienda en Llucmajor con humedad que sube por los muros de planta baja. Pregunta por inyecciones y plazos.'}},
    {id:3, canal:'gmail', asunto:'IEE del edificio · deficiencias estructurales', preview:'Adjuntamos el informe IEE que nos marca deficiencias en pilares de la planta sótano. Queremos saber qué opciones de reparación hay…', remitente_nombre:'Antoni Riera', remitente_email:'presidencia.sonferriol@correo.example', recibido_at:ago(55), estado:'error_wa', wa_error:'HTTP 401 · apikey de Evolution no válida', es_cliente:true, cliente_id:3, oportunidad_id:3,
     extraccion:{nombre:'Antoni Riera', empresa:'CP Son Ferriol', email:'presidencia.sonferriol@correo.example', telefono:'+34600000303', tipo_cliente:'comunidad', servicio:'IEE / ITE', solicita:'presupuesto', urgencia:'media', direccion_obra:'C/ Son Ferriol 8', municipio:'Palma', titulo:'Deficiencias IEE en pilares del sótano', resumen:'Presidente de CP Son Ferriol. El IEE marca deficiencias en pilares del sótano. Pide opciones de reparación y presupuesto orientativo.'}},
    {id:2, canal:'gmail', asunto:'Novedades de producto · noviembre', preview:'Descubre los nuevos morteros de reparación estructural y las jornadas técnicas de diciembre…', remitente_nombre:'Morteros Técnicos', remitente_email:'news@proveedor.example', recibido_at:ago(70), estado:'ignorado', es_cliente:false, extraccion:{motivo:'Boletín comercial de un proveedor'}},
    {id:1, canal:'gmail', asunto:'Refuerzo de pilar para reforma de local', preview:'Necesitamos reforzar un pilar para abrir un hueco en un local de Palma. Adjunto planos…', remitente_nombre:'Laura Ferrer', remitente_email:'laura.ferrer@estudio.example', recibido_at:ago(60 * 26), estado:'enviado_wa', es_cliente:true, wa_enviado_at:ago(60 * 26), cliente_id:4, oportunidad_id:5,
     extraccion:{nombre:'Laura Ferrer', empresa:'Estudio Ferrer Arquitectura', email:'laura.ferrer@estudio.example', tipo_cliente:'arquitecto_ingenieria', servicio:'Refuerzo estructural', solicita:'presupuesto', urgencia:'baja', municipio:'Palma', titulo:'Refuerzo de pilar para reforma', resumen:'Estudio de arquitectura necesita reforzar un pilar para abrir un hueco en un local de Palma.'}}
  ],
  eventos: [
    {agente:'ECO', nivel:'warn', texto:'Cliente Carmen Vidal: grietas en dos vigas del garaje de Av. Argentina 41. Urgencia alta.', created_at:ago(12)},
    {agente:'ECO', nivel:'info', texto:'Datos del cliente enviados al WhatsApp de Dirección.', created_at:ago(12)},
    {agente:'ATLAS', nivel:'info', texto:'WhatsApp nuevo de Miquel Pons (Llucmajor): humedad por capilaridad.', created_at:ago(25)},
    {agente:'ECO', nivel:'warn', texto:'No se pudo enviar el aviso por WhatsApp: HTTP 401 · apikey de Evolution no válida.', created_at:ago(55)},
    {agente:'ECO', nivel:'info', texto:'Correo ignorado (no es cliente): Novedades de producto · noviembre.', created_at:ago(70)},
    {agente:'DIRECCION', nivel:'info', texto:'Oportunidad #5 movida a «presupuesto».', created_at:ago(60 * 20)},
    {agente:'SISTEMA', nivel:'info', texto:'Esquema R4 instalado o actualizado.', created_at:ago(60 * 30)}
  ]
};
(() => { const byId = Object.fromEntries(DEMO.clientes.map(c => [c.id, c])); DEMO.oportunidades.forEach(o => { const c = byId[o.cliente_id] || {}; Object.assign(o, { cliente_nombre:c.nombre, cliente_empresa:c.empresa, cliente_email:c.email, cliente_tel:c.telefono, organizacion_tipo:c.organizacion_tipo }); }); })();
const D = () => isLive() ? live.data : DEMO;
const cfg = () => D().config || {};
function clientesDe(d){
  if (Array.isArray(d.clientes) && d.clientes.length) return d.clientes;
  const seen = new Map();
  (d.oportunidades || []).forEach(o => { const k = o.cliente_id || o.cliente_email || o.cliente_tel || o.cliente_nombre; if (k && !seen.has(k)) seen.set(k, { id:o.cliente_id || k, nombre:o.cliente_nombre, empresa:o.cliente_empresa, email:o.cliente_email, telefono:o.cliente_tel, organizacion_tipo:o.organizacion_tipo, origen:o.canal, created_at:o.created_at }); });
  return [...seen.values()];
}

async function api(path, opts){
  const r = await fetch(path, Object.assign({ headers:{'Content-Type':'application/json'}, credentials:'same-origin', cache:'no-store' }, opts || {}));
  let body = null; try { body = await r.json(); } catch(e) {}
  if (!r.ok){ const err = new Error((body && (body.message || body.error)) || ('HTTP ' + r.status)); err.status = r.status; throw err; }
  return body;
}
async function checkSession(){
  try { const s = await api('/api/session'); live.configured = !!s.configured; live.authed = !!s.authenticated; live.noBackend = false; }
  catch(e){ live.authed = false; live.configured = null; live.noBackend = true; }
}
async function loadData(quiet){
  if (!live.authed) return;
  live.loading = true; if (!quiet) updateChrome();
  try { const r = await api('/api/r4?op=summary'); live.data = r.data || r; live.error = null; live.at = new Date(); }
  catch(e){ live.error = e.message; if (e.status === 401){ live.authed = false; live.data = null; } }
  live.loading = false; render();
}
function demoAct(p){
  const d = DEMO;
  if (p.op === 'set_etapa'){ const o = d.oportunidades.find(x => x.id === p.id); if (o){ o.etapa = p.etapa; o.motivo_perdida = p.motivo || null; } }
  if (p.op === 'update_inmueble'){ const i = d.inmuebles.find(x => x.id === p.id); if (i){ if (p.anio_construccion) i.anio_construccion = Number(p.anio_construccion); if (p.tipo_estructura) i.tipo_estructura = p.tipo_estructura; if (p.iee_fecha) i.iee_fecha = p.iee_fecha; const y = new Date().getFullYear(); i.alerta_iee = !i.anio_construccion && !i.iee_fecha ? 'sin_datos' : !i.iee_fecha && i.anio_construccion <= y - 50 ? 'sin_iee' : i.iee_fecha && (Date.now() - Date.parse(i.iee_fecha)) > 9.5 * 365.25 * 864e5 ? 'renovar' : 'ok'; } }
  if (p.op === 'set_config') Object.assign(d.config, p.config);
  if (p.op === 'update_extraccion'){ const m = d.mensajes.find(x => x.id === p.id); if (m) Object.assign(m.extraccion, p.extraccion); }
  if (p.op === 'marcar_ignorado'){ const m = d.mensajes.find(x => x.id === p.id); if (m){ m.es_cliente = false; m.estado = 'ignorado'; } }
  if (p.op === 'reenviar_wa' || p.op === 'marcar_cliente'){ const m = d.mensajes.find(x => x.id === p.id); if (m){ m.es_cliente = true; m.estado = 'enviado_wa'; m.wa_enviado_at = new Date().toISOString(); m.wa_error = null; } return { wa_enviado: true }; }
  return {};
}
async function act(payload, okMsg){
  if (live.busy) return;
  if (!isLive()){ const r = demoAct(payload); toast((typeof okMsg === 'function' ? okMsg(r) : okMsg) + ' · demostración'); live.editing = false; render(); return; }
  live.busy = true; render();
  try { const r = await api('/api/r4', { method:'POST', body: JSON.stringify(payload) }); toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); live.editing = false; live.busy = false; await loadData(true); }
  catch(e){ live.busy = false; toast('No se pudo completar: ' + e.message); render(); }
}

function liveBanner(){
  if (isLive()) return live.error ? `<div class="callout">${pill('Sin conexión','crit')} No se pudo actualizar: ${e2(live.error)}. Últimos datos de las ${fmtHora(live.at)}.</div>` : '';
  if (live.noBackend) return `<div class="callout"><b>Demostración interactiva.</b> Puedes tocar, mover oportunidades y editar: los cambios se quedan en esta vista. Los datos reales se ven en la plataforma desplegada.</div>`;
  if (live.configured === false) return `<div class="callout"><b>Demostración.</b> Falta activar la conexión con los datos reales: variables <span class="code-inline">R4_PANEL_PASSWORD</span> y <span class="code-inline">R4_API_KEY</span> en Vercel.</div>`;
  if (live.authed && live.loading) return `<div class="callout">Cargando datos reales…</div>`;
  if (live.authed && live.error) return `<div class="callout">${pill('Sin conexión','crit')} ${e2(live.error)}. Revisa que el flujo «R4 · API» esté publicado en n8n.</div>`;
  return `<div class="callout"><b>Demostración.</b> Pulsa <b>Conectar datos reales</b> para ver lo que leen ECO (Gmail) y ATLAS (WhatsApp).</div>`;
}

/* ---- WhatsApp: mismo formato que el nodo «Componer WhatsApp» de n8n ---- */
function waPreview(m){
  const x = Object.assign({ email: m.remitente_email || '', nombre: m.remitente_nombre || '' }, m.extraccion || {});
  const campos = String(cfg().wa_campos || 'nombre,empresa,email,telefono,servicio,urgencia,resumen').split(',').map(s=>s.trim()).filter(Boolean);
  const l = ['*NUEVO ' + (m.canal === 'whatsapp' ? 'WHATSAPP' : 'CORREO') + ' DE CLIENTE · R4*' + (x.urgencia === 'alta' ? ' 🔴 URGENTE' : '')];
  campos.forEach(c => { const v = x[c]; if (v != null && String(v).trim()) l.push('*' + (ETQ[c] || c) + ':* ' + String(v).trim()); });
  if (cfg().plataforma_url) l.push('*Ficha:* ' + String(cfg().plataforma_url).replace(/\/+$/, '') + '/#bandeja');
  l.push('_Mensaje #' + m.id + ' · oportunidad #' + (m.oportunidad_id || '—') + '_');
  return l.join('\n');
}

/* ---- Iconos (trazo simple, propios) ---- */
const ICO = {
  wa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9.5 9.5c.3 1.6 1.9 3.6 3.9 4.3l1.2-1.1 1.8.8c-.3 1.2-1.3 1.7-2.4 1.5-2.9-.5-5.4-3-5.9-5.9-.2-1.1.3-2.1 1.5-2.4l.8 1.8z"/></svg>',
  tel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/></svg>'
};
const qa = (lbl, href, ico, ok) => ok ? `<a href="${href}" ${href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}><span class="btn round">${ico}</span><span class="lbl">${lbl}</span></a>`
  : `<span aria-disabled="true" style="opacity:.4;display:grid;justify-items:center;gap:6px"><span class="btn round" style="pointer-events:none">${ico}</span><span class="lbl">${lbl}</span></span>`;

/* ---- 00 Mission Control · simétrico, conexiones en tiempo real ---- */
function redConexiones(){
  const d = D(), ch = d.canales || {}, c = cfg(), k = d.kpis || {};
  const waOk = c.evolution_url && c.evolution_instancia && c.wa_destino_direccion;
  const N = [
    { id:'gmail', x:14, y:24, t:'Gmail', s:'ECO lee y extrae', on:!!ch.ultimo_gmail, st: ch.ultimo_gmail ? 'Último correo ' + fmtFecha(ch.ultimo_gmail) : 'Falta conectar la cuenta' },
    { id:'wa', x:14, y:76, t:'WhatsApp · clientes', s:'ATLAS conversa', on:!!ch.ultimo_whatsapp, st: ch.ultimo_whatsapp ? 'Último mensaje ' + fmtFecha(ch.ultimo_whatsapp) : 'Evolution sin webhook' },
    { id:'ia', x:50, y:12, t:'IA · OpenAI', s:'Extracción JSON estricta', on:true, st:'gpt-4o-mini' },
    { id:'core', x:50, y:50, t:'n8n · ATLAS · ECO', s:'Orquestador de R4', on:true, st:isLive() ? 'En línea' : 'Demostración', core:true },
    { id:'pg', x:86, y:24, t:'Postgres · r4', s:'Ficha única de cliente', on:true, st:(k.clientes_total || 0) + ' clientes · ' + (k.oportunidades_abiertas || 0) + ' abiertas' },
    { id:'app', x:86, y:76, t:'Plataforma R4', s:'Vercel · Dirección', on:true, st:isLive() ? 'Sesión activa' : 'Vista de demostración' },
    { id:'aviso', x:50, y:88, t:'Avisos a Dirección', s:'Evolution sendText', on:!!waOk && !k.errores_wa, warn:!!waOk && !!k.errores_wa, st: !waOk ? 'Falta configurar' : k.errores_wa ? k.errores_wa + ' con error' : (k.wa_hoy || 0) + ' enviados hoy' }
  ];
  const P = Object.fromEntries(N.map(n => [n.id, n]));
  const L = [['gmail','core'],['wa','core'],['ia','core'],['core','pg'],['core','app'],['core','aviso']];
  const path = (a, b) => { const A = P[a], B = P[b]; const mx = (A.x + B.x) / 2; return A.y === B.y || A.x === B.x ? `M${A.x} ${A.y} L${B.x} ${B.y}` : `M${A.x} ${A.y} C${mx} ${A.y} ${mx} ${B.y} ${B.x} ${B.y}`; };
  const lines = L.map(([a, b]) => { const on = P[a].on && P[b].on; return `<path class="ln ${on ? 'on' : 'pend'}" d="${path(a, b)}" vector-effect="non-scaling-stroke"/>`; }).join('');
  const nodes = N.map(n => `<div class="nd ${n.core ? 'core' : ''}" style="left:${n.x}%;top:${n.y}%"><div class="node-card ${n.on ? '' : 'pend'} ${n.core ? 'core' : ''}"><div class="ni"><b>${n.t}</b><span>${n.s}</span><span class="stt">${e2(n.st)}</span></div></div></div>`).join('');
  return `<div class="mc-net" role="img" aria-label="Conexiones de R4: Gmail y WhatsApp entran al orquestador n8n, que usa la IA, guarda en Postgres, alimenta la plataforma y avisa a Dirección"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="gradPlasma" x1="0" x2="1"><stop offset="0" stop-color="#4fd8ff"/><stop offset="1" stop-color="#00ff7f"/></linearGradient></defs>${lines}</svg>${nodes}</div>`;
}
function vistaMission(){
  const d = D(), k = d.kpis || {};
  const ev = (d.eventos || []).slice(0, 9);
  const opp = (d.oportunidades || []).filter(o => o.etapa === 'nuevo').slice(0, 5);
  const obrasRows = obras.slice(0, 4).map(o => { const h = health(o); return `<tr><td><span class="mono small muted">${o.id}</span><div><b>${esc(o.cliente)}</b></div><div class="muted small">${esc(o.trabajo)}</div></td><td>${prog(o.avance)}</td><td>${pill(healthLabel[h], h)}</td></tr>`; }).join('');
  return `${liveBanner()}
  <div class="kpis">
    <div class="kpi"><span class="l">Mensajes hoy</span><span class="v">${k.mensajes_hoy || 0}</span><span class="d">${k.clientes_hoy || 0} de clientes · ${k.ignorados_hoy || 0} ignorados</span></div>
    <div class="kpi ${k.errores_wa ? 'alerta' : ''}"><span class="l">Avisos WhatsApp hoy</span><span class="v">${k.wa_hoy || 0}</span><span class="d">${k.errores_wa ? k.errores_wa + ' con error de envío' : 'Sin errores de envío'}</span></div>
    <div class="kpi"><span class="l">Oportunidades abiertas</span><span class="v">${k.oportunidades_abiertas || 0}</span><span class="d">${k.clientes_7d || 0} clientes nuevos en 7 días</span></div>
    <div class="kpi ${k.alertas_iee ? 'alerta' : ''}"><span class="l">Alertas IEE</span><span class="v">${k.alertas_iee || 0}</span><span class="d">${k.organizaciones || 0} organizaciones · ${k.clientes_total || 0} clientes</span></div>
  </div>
  ${panel('Conexiones en tiempo real', redConexiones(), `${srcTag(isLive())}<span class="agent">ATLAS</span><span class="agent">ECO</span>`)}
  <div class="grid g-2">
    ${panel('Actividad de los agentes', ev.length ? `<ul class="feed">${ev.map(f => `<li><time>${fmtFecha(f.created_at)}</time><span class="agent-col"><span class="agent">${e2(f.agente)}</span></span><span>${f.nivel !== 'info' ? pill(f.nivel === 'crit' ? 'Alerta' : 'Aviso', f.nivel) + ' ' : ''}${e2(f.texto)}</span></li>`).join('')}</ul>` : `<div class="empty"><b>Sin actividad todavía</b></div>`, isLive() ? `${srcTag(true)} ${fmtHora(live.at)}` : srcTag(false), true)}
    ${panel('Nuevas solicitudes', opp.length ? `<ul class="steps">${opp.map(o => `<li><span class="st now"></span><span><b>${e2(o.titulo)}</b><br><span class="muted small">${e2([o.cliente_nombre, o.cliente_empresa, o.municipio].filter(Boolean).join(' · '))}</span></span>${o.urgencia ? pill(o.urgencia, urgCls(o.urgencia)) : ''}</li>`).join('')}</ul><div style="margin-top:14px"><a class="btn primary" href="#crm">Abrir CRM</a></div>` : `<div class="empty"><b>Sin solicitudes nuevas</b></div>`, srcTag(isLive()))}
  </div>
  ${panel('Obras en curso', `<div class="tbl-wrap"><table><thead><tr><th>Obra</th><th>Avance</th><th>Estado</th></tr></thead><tbody>${obrasRows}</tbody></table></div>`, `<span class="src demo">Ejemplo</span> fase 4`, true)}`;
}

/* ---- 01 CRM · orden Apple: Contactos → ficha · Embudo táctil · Inmuebles ---- */
const IEE = { sin_iee:['Más de 50 años sin IEE','crit'], renovar:['IEE a renovar','warn'], ok:['IEE al día','ok'], sin_datos:['Faltan año e IEE',''] };
function inmueblesPanel(list){
  const body = list.length ? `<div class="tbl-wrap"><table><thead><tr><th>Inmueble</th><th class="n">Año</th><th>Estructura</th><th>IEE</th><th></th></tr></thead><tbody>${list.slice(0, 40).map(i => live.editInm === i.id
    ? `<tr><td colspan="5"><form id="inm-form" data-id="${i.id}" class="form-grid" style="grid-template-columns:150px minmax(0,1fr);padding:8px 0"><span class="small"><b>${e2(i.direccion)}</b></span><span class="small muted">${e2(i.municipio || '')}</span>
        <label for="inm-anio">Año</label><input id="inm-anio" name="anio_construccion" value="${e2(i.anio_construccion || '')}" inputmode="numeric" placeholder="1968">
        <label for="inm-est">Estructura</label><input id="inm-est" name="tipo_estructura" value="${e2(i.tipo_estructura || '')}" placeholder="Hormigón armado, viguetas…">
        <label for="inm-iee">Fecha del IEE</label><input id="inm-iee" name="iee_fecha" type="date" value="${e2(i.iee_fecha || '')}">
        <span></span><div style="display:flex;gap:10px"><button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>Guardar</button><button class="btn" type="button" data-inm-cancel>Cancelar</button></div></form></td></tr>`
    : `<tr><td>${e2(i.direccion)}<div class="muted small">${e2([i.municipio, i.organizacion].filter(Boolean).join(' · '))}</div></td><td class="n">${e2(i.anio_construccion || '—')}</td><td class="small">${e2(i.tipo_estructura || '—')}</td><td>${pill((IEE[i.alerta_iee] || IEE.sin_datos)[0], (IEE[i.alerta_iee] || IEE.sin_datos)[1])}</td><td class="n"><button class="btn" type="button" data-inm-edit="${i.id}">Editar</button></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty"><b>Aún no hay inmuebles</b><span>ECO los crea cuando un correo menciona la dirección de la obra.</span></div>`;
  return panel('Inmuebles · alerta IEE', body, `${srcTag(isLive())} Más de 50 años o IEE de 10 años`, true);
}
function fichaCliente(c, d){
  const opps = (d.oportunidades || []).filter(o => String(o.cliente_id) === String(c.id));
  const inmIds = new Set(opps.map(o => o.inmueble_id).filter(Boolean));
  const inms = (d.inmuebles || []).filter(i => inmIds.has(i.id));
  const msgs = (d.mensajes || []).filter(m => String(m.cliente_id) === String(c.id));
  const tel = String(c.telefono || '').replace(/[^0-9+]/g, ''), wa = tel.replace(/\D/g, '');
  const tipo = TIPOS[c.organizacion_tipo] || TIPOS[c.tipo] || '';
  const fila = (k, v, extra) => `<div class="row"><span class="k">${k}</span><span class="v">${v || '<span class="muted">—</span>'}</span>${extra || '<span></span>'}</div>`;
  const stepper = o => `<div class="stepper" role="group" aria-label="Etapa de la oportunidad">${ETAPAS.map(([k, l], i) => { const cur = ETAPAS.findIndex(e => e[0] === o.etapa); return `<button type="button" data-step-opp="${o.id}" data-step="${k}" class="${i < cur ? 'done' : ''}" ${k === o.etapa ? 'aria-current="step"' : ''} ${live.busy ? 'disabled' : ''}>${l}</button>`; }).join('')}</div>`;
  return `<div style="display:grid;gap:18px;min-width:0" id="ficha">
    <article class="contact-hero"><div class="hero-in">
      <div class="avatar xl">${e2(iniciales(c.nombre || c.empresa))}</div>
      <h2>${e2(c.nombre || c.empresa || 'Sin nombre')}</h2>
      <div class="org">${e2([c.empresa && c.empresa !== c.nombre ? c.empresa : '', tipo].filter(Boolean).join(' · '))}</div>
      <div class="row" style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center">${pill(c.origen === 'whatsapp' ? 'Llegó por WhatsApp' : c.origen === 'gmail' ? 'Llegó por Gmail' : 'Alta manual', 'info')}${pill('RGPD · ' + (c.base_legal === 'consentimiento' ? 'consentimiento' : 'medidas precontractuales'))}</div>
      <div class="quick">${qa('WhatsApp', 'https://wa.me/' + wa, ICO.wa, wa.length >= 9)}${qa('Llamar', 'tel:' + tel, ICO.tel, tel.length >= 9)}${qa('Email', 'mailto:' + (c.email || ''), ICO.mail, !!c.email)}${qa('Mensajes', '#bandeja', ICO.inbox, msgs.length > 0)}</div>
    </div></article>
    ${panel('Datos de contacto', `<div class="group">${fila('Teléfono', tel ? `<span class="mono">${e2(tel)}</span>` : '')}${fila('Email', c.email ? `<span class="mono small">${e2(c.email)}</span>` : '')}${fila('Organización', e2(c.empresa || ''))}${fila('Tipo', e2(tipo))}${fila('Alta', fmtFecha(c.created_at))}</div>`, srcTag(isLive()), true)}
    ${panel('Oportunidades', opps.length ? opps.map(o => `<div class="opp"><div style="display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap"><span><span class="t">${e2(o.titulo)}</span><br><span class="small muted">${e2([o.servicio, o.municipio, fmtFecha(o.created_at)].filter(Boolean).join(' · '))}</span></span><span style="display:flex;gap:6px;flex-wrap:wrap">${o.urgencia ? pill('Urgencia ' + o.urgencia, urgCls(o.urgencia)) : ''}${o.etapa === 'perdido' ? pill('Perdida' + (o.motivo_perdida ? ' · ' + o.motivo_perdida : ''), 'crit') : ''}</span></div>${o.etapa === 'perdido' ? `<div style="margin-top:10px"><button class="btn" type="button" data-step-opp="${o.id}" data-step="nuevo">Reabrir</button></div>` : stepper(o) + `<div style="margin-top:10px;text-align:right"><button class="btn danger" type="button" data-step-opp="${o.id}" data-step="perdido" ${live.busy ? 'disabled' : ''}>Marcar perdida</button></div>`}</div>`).join('') : '<div class="empty">Sin oportunidades</div>', 'Toca una etapa para moverla', true)}
    ${inms.length ? panel('Inmuebles', `<div class="group">${inms.map(i => fila(e2(i.municipio || 'Inmueble'), e2(i.direccion) + (i.anio_construccion ? ` <span class="muted small">· ${i.anio_construccion}</span>` : ''), pill((IEE[i.alerta_iee] || IEE.sin_datos)[0], (IEE[i.alerta_iee] || IEE.sin_datos)[1]))).join('')}</div>`, '', true) : ''}
    ${panel('Actividad', msgs.length ? `<ul class="timeline">${msgs.map(m => `<li><time>${fmtFecha(m.recibido_at)}</time><span><span class="ch ${m.canal === 'whatsapp' ? 'wa' : 'gmail'}">${m.canal === 'whatsapp' ? 'WhatsApp' : 'Gmail'}</span> <b>${e2(m.asunto || '')}</b><br><span class="small muted">${e2((m.extraccion && m.extraccion.resumen) || m.preview || '')}</span><br><button class="btn" type="button" style="margin-top:8px;min-height:40px" data-open-msg="${m.id}">Abrir en Bandeja</button></span></li>`).join('')}</ul>` : '<div class="empty">Sin mensajes</div>', `${msgs.length} mensajes`, true)}
  </div>`;
}
function vistaCRM(){
  const d = D(), ops = d.oportunidades || [], tab = live.crmTab;
  const tabs = `<div class="crm-tabs"><div class="seg" role="group" aria-label="Vista del CRM">${[['contactos','Contactos'],['embudo','Embudo'],['inmuebles','Inmuebles']].map(([k, l]) => `<button type="button" data-crm-tab="${k}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div><span style="display:flex;gap:8px;flex-wrap:wrap">${pill(clientesDe(d).length + ' contactos', 'info')}${pill(ops.filter(o => !['aceptado','perdido'].includes(o.etapa)).length + ' oportunidades abiertas', 'ok')}${srcTag(isLive())}</span></div>`;
  if (tab === 'inmuebles') return `${liveBanner()}${tabs}${inmueblesPanel(d.inmuebles || [])}`;
  if (tab === 'embudo'){
    const cols = ETAPAS.concat([['perdido','Perdido']]).map(([key]) => {
      const deals = ops.filter(o => o.etapa === key);
      return `<div class="col" data-col="${key}"><h3><span>${ETAPA_LARGA[key]}</span><span class="num">${deals.length}</span></h3>${deals.map(o => `<article class="deal" data-deal="${o.id}">
        <div style="display:flex;gap:8px;align-items:flex-start;justify-content:space-between"><b>${e2(o.titulo)}</b><button class="grip" type="button" data-drag="${o.id}" aria-label="Arrastrar a otra etapa">⠿</button></div>
        <span class="who">${e2([o.cliente_nombre || o.cliente_email, o.cliente_empresa, o.municipio].filter(Boolean).join(' · '))}</span>
        <div class="row">${pill(o.canal === 'whatsapp' ? 'WhatsApp' : o.canal === 'gmail' ? 'Gmail' : (o.canal || '—'))}${o.urgencia ? pill(o.urgencia, urgCls(o.urgencia)) : ''}${o.motivo_perdida ? pill(o.motivo_perdida, 'crit') : ''}</div>
        <label class="small muted" style="display:grid;gap:4px">Mover a<select class="inp" data-etapa-for="${o.id}" ${live.busy ? 'disabled' : ''}>${ETAPAS.concat([['perdido','Perdido']]).map(([k2]) => `<option value="${k2}" ${k2 === o.etapa ? 'selected' : ''}>${ETAPA_LARGA[k2]}</option>`).join('')}</select></label></article>`).join('')}</div>`;
    }).join('');
    return `${liveBanner()}${tabs}${panel('Embudo de oportunidades', `<div class="kanban" style="grid-template-columns:repeat(6,minmax(220px,1fr))">${cols}</div><p class="note" style="margin-top:12px">Arrastra con el asa ⠿ (dedo o ratón) o usa «Mover a».</p>`, 'Nuevo → Contactado → Visita → Presupuesto → Aceptado')}`;
  }
  const q = live.q.trim().toLowerCase();
  const cl = clientesDe(d).filter(c => !q || [c.nombre, c.empresa, c.email, c.telefono].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => String(a.nombre || a.empresa || '').localeCompare(String(b.nombre || b.empresa || ''), 'es'));
  if (!cl.find(c => String(c.id) === String(live.cliId))) live.cliId = cl[0] ? cl[0].id : null;
  let lastL = '', rows = '';
  cl.forEach(c => { const L0 = String(c.nombre || c.empresa || '#').trim()[0].toUpperCase(); if (L0 !== lastL){ rows += `<div class="letter">${e2(L0)}</div>`; lastL = L0; }
    const nOpp = ops.filter(o => String(o.cliente_id) === String(c.id) && !['aceptado','perdido'].includes(o.etapa)).length;
    rows += `<button class="crm-row" type="button" role="option" aria-selected="${String(c.id) === String(live.cliId)}" data-cli="${e2(c.id)}"><span class="avatar">${e2(iniciales(c.nombre || c.empresa))}</span><span style="min-width:0"><span class="nm">${e2(c.nombre || c.empresa || 'Sin nombre')}</span><span class="sb">${e2([c.empresa && c.empresa !== c.nombre ? c.empresa : '', nOpp ? nOpp + ' abierta' + (nOpp > 1 ? 's' : '') : ''].filter(Boolean).join(' · ') || c.email || c.telefono || '')}</span></span><span class="chev" aria-hidden="true">›</span></button>`; });
  const sel = cl.find(c => String(c.id) === String(live.cliId));
  return `${liveBanner()}${tabs}<div class="crm-shell">
    ${panel('Contactos', `<div class="search"><input id="crm-q" type="search" placeholder="Buscar nombre, empresa, email o teléfono" value="${e2(live.q)}" aria-label="Buscar contactos"></div><div role="listbox" aria-label="Contactos">${rows || '<div class="empty">Sin resultados</div>'}</div>`, `${cl.length}`, true)}
    ${sel ? fichaCliente(sel, d) : panel('Ficha', '<div class="empty"><b>Sin contactos todavía</b><span>ECO crea la ficha con el primer correo de cada cliente.</span></div>')}
  </div>`;
}

/* ---- 02 Bandeja ---- */
function vistaBandeja(){
  const msgs = D().mensajes || [];
  if (!msgs.length) return `${liveBanner()}${panel('Entrada', `<div class="empty"><b>Aún no ha llegado ningún mensaje</b><span>Cuando la cuenta Gmail de R4 esté conectada al flujo ECO, cada correo aparecerá aquí en menos de un minuto.</span></div>`, '<span class="agent">ECO</span><span class="agent">ATLAS</span>')}`;
  let m = msgs.find(x => x.id === live.msgId); if (!m){ m = msgs[0]; live.msgId = m.id; live.editing = false; }
  const list = msgs.map(mm => `<button class="msg" type="button" role="option" aria-selected="${mm.id === m.id}" data-live-msg="${mm.id}">
      <span class="ch ${mm.canal === 'whatsapp' ? 'wa' : 'gmail'}">${mm.canal === 'whatsapp' ? 'WhatsApp' : 'Gmail'}</span>
      <span style="min-width:0"><span class="subj">${e2(mm.asunto || (mm.extraccion && mm.extraccion.titulo) || '(sin asunto)')}</span><br><span class="prev">${e2((mm.extraccion && mm.extraccion.resumen) || mm.preview || '')}</span></span>
      <time>${fmtFecha(mm.recibido_at)}</time></button>`).join('');
  const est = ESTADOS[m.estado] || [m.estado, ''];
  const x = Object.assign({ email: m.remitente_email || '', nombre: m.remitente_nombre || '' }, m.extraccion || {});
  const dis = live.busy ? 'disabled' : '';
  const original = `<details style="margin-top:16px"><summary class="small muted" style="cursor:pointer;min-height:40px;display:flex;align-items:center">Ver mensaje original · ${e2(m.remitente_nombre || '')} &lt;${e2(m.remitente_email || m.remitente_tel || '')}&gt;</summary><div class="wa-preview" style="margin-top:8px">${e2(m.preview || '')}</div></details>`;
  let detail;
  if (m.es_cliente === true && live.editing){
    detail = `<form id="edit-form" class="form-grid">${EDITABLES.map(c => `<label for="ed-${c}">${ETQ[c]}</label>${c === 'resumen' ? `<textarea id="ed-${c}" name="${c}">${e2(x[c])}</textarea>` : c === 'urgencia' ? `<select id="ed-${c}" name="${c}">${['alta','media','baja'].map(u => `<option ${x[c] === u ? 'selected' : ''}>${u}</option>`).join('')}</select>` : `<input id="ed-${c}" name="${c}" value="${e2(x[c])}">`}`).join('')}
      <span></span><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" type="submit" ${dis}>Guardar corrección</button><button class="btn" type="button" data-lact="cancelar">Cancelar</button></div></form>`;
  } else if (m.es_cliente === true){
    detail = `<dl class="fields">${['nombre','empresa','email','telefono','servicio','solicita','direccion_obra','municipio'].map(c => `<dt>${ETQ[c]}</dt><dd class="${c === 'email' || c === 'telefono' ? 'mono small' : ''}">${e2(x[c] || '—')}</dd>`).join('')}
        <dt>Urgencia</dt><dd>${x.urgencia ? pill(x.urgencia, urgCls(x.urgencia)) : '—'}</dd><dt>Resumen</dt><dd>${e2(x.resumen || '—')}</dd></dl>
      <div style="display:grid;gap:8px;margin-top:16px"><span class="small muted">Aviso para el WhatsApp de Dirección ${m.wa_enviado_at ? '· enviado ' + fmtFecha(m.wa_enviado_at) : ''}</span><div class="wa-preview">${e2(waPreview(m))}</div>${m.wa_error ? `<span class="small" style="color:var(--crit)">Último error: ${e2(m.wa_error)}</span>` : ''}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><button class="btn plasma" type="button" data-lact="reenviar" ${dis}>${m.wa_enviado_at ? 'Reenviar a WhatsApp' : 'Enviar a WhatsApp'}</button><button class="btn" type="button" data-lact="editar" ${dis}>Corregir datos</button>${m.cliente_id ? `<button class="btn" type="button" data-open-cli="${m.cliente_id}">Ver ficha</button>` : ''}<button class="btn danger" type="button" data-lact="ignorar" ${dis}>No es cliente</button></div>`;
  } else if (m.es_cliente === false){
    detail = `<div class="callout">ECO ha marcado este mensaje como <b>no cliente</b>${x.motivo ? ': ' + e2(x.motivo) : ''}. No crea ficha ni envía WhatsApp.</div><div style="margin-top:14px"><button class="btn primary" type="button" data-lact="cliente" ${dis}>Es un cliente: procesar</button></div>`;
  } else {
    detail = `<div class="callout">ECO está procesando este mensaje. Actualiza en unos segundos.</div><div style="margin-top:14px"><button class="btn" type="button" data-lact="refresh">Actualizar</button></div>`;
  }
  return `${liveBanner()}<div class="grid g-1-2">
    ${panel('Entrada', `<div role="listbox" aria-label="Mensajes recibidos">${list}</div>`, `${srcTag(isLive())}<span class="agent">ECO</span><span class="agent">ATLAS</span>`, true)}
    ${panel('Extracción de ECO · mensaje #' + m.id, detail + original, pill(est[0], est[1]))}
  </div>`;
}

/* ---- 09 ATLAS ---- */
function vistaAtlas(){
  const d = D(), k = d.kpis || {}, msgs = d.mensajes || [];
  const waHoy = msgs.filter(m => m.canal === 'whatsapp' && dayKey(m.recibido_at) === dayKey(Date.now())).length;
  const stats = { ATLAS: waHoy + ' mensajes de WhatsApp registrados', ECO: (k.clientes_hoy || 0) + ' clientes · ' + (k.ignorados_hoy || 0) + ' ignorados · ' + (k.wa_hoy || 0) + ' avisos' };
  return `${liveBanner()}<div class="agents">${agentes.map(a => `<article class="agent-card ${a.lead ? 'lead' : ''}"><h3><span class="dot ${stats[a.n] ? '' : 'off'}" aria-hidden="true"></span>${a.n}</h3><p>${esc(a.txt)}</p><div class="stat"><span>Hoy</span><b>${stats[a.n] ? e2(stats[a.n]) : 'Fase siguiente'}</b></div><div class="stat"><span>Canal</span><span>${esc(a.canal)}</span></div><div class="stat"><span>Estado</span><span>${stats[a.n] ? pill(isLive() ? 'Conectado' : 'Demostración', 'ok') : pill('Diseñado','')}</span></div></article>`).join('')}</div>
  ${panel('Reglas de ATLAS', `<ul class="steps">
    <li><span class="st done"></span><span>La IA prepara, resume y propone; una persona de R4 aprueba presupuestos, emite facturas y cierra el mes.</span><span></span></li>
    <li><span class="st done"></span><span>ECO trata el contenido de los correos como datos, nunca como instrucciones.</span><span></span></li>
    <li><span class="st done"></span><span>Todo lo que entra por WhatsApp o Gmail queda en la ficha del cliente o de la obra.</span><span></span></li>
    <li><span class="st done"></span><span>Escala a Dirección por WhatsApp cuando un cliente lo pide, hay riesgo o un agente no está seguro.</span><span></span></li></ul>`)}`;
}

/* ---- 10 Configuración ---- */
function configLiveTop(){
  const c = cfg(), campos = String(c.wa_campos || '').split(',').map(s=>s.trim());
  const opts = ['nombre','empresa','email','telefono','servicio','urgencia','solicita','tipo_cliente','direccion_obra','municipio','titulo','resumen'];
  return `${liveBanner()}${panel('WhatsApp y Gmail · ajustes de ECO', `<form id="cfg-form" class="form-grid">
      <label for="cf-url">URL de Evolution API</label><input id="cf-url" name="evolution_url" value="${e2(c.evolution_url)}" placeholder="https://evolution.midominio.com" inputmode="url">
      <span class="hint">Sin barra final. La apikey va en la credencial «Evolution API R4» de n8n, nunca aquí.</span>
      <label for="cf-inst">Instancia</label><input id="cf-inst" name="evolution_instancia" value="${e2(c.evolution_instancia)}" placeholder="ATLASR4">
      <label for="cf-dest">WhatsApp de Dirección</label><input id="cf-dest" name="wa_destino_direccion" value="${e2(c.wa_destino_direccion)}" placeholder="34600000000, 34611111111" inputmode="tel">
      <span class="hint">Recibe los avisos de cada cliente nuevo. Prefijo de país sin «+»; varios separados por coma.</span>
      <label>Datos que se envían</label><div class="checks">${opts.map(o => `<label><input type="checkbox" name="wa_campos" value="${o}" ${campos.includes(o) ? 'checked' : ''}>${ETQ[o]}</label>`).join('')}</div>
      <label for="cf-gmail">Cuenta Gmail de ECO</label><input id="cf-gmail" name="gmail_cuenta" value="${e2(c.gmail_cuenta)}" placeholder="cuenta nueva de R4" inputmode="email">
      <label for="cf-url-pl">URL de la plataforma</label><input id="cf-url-pl" name="plataforma_url" value="${e2(c.plataforma_url)}" placeholder="https://r4.vercel.app" inputmode="url">
      <span class="hint">Se añade como enlace «Ficha» en cada aviso de WhatsApp.</span>
      <label for="cf-on">Avisos de ECO</label><select id="cf-on" name="eco_activo"><option value="true" ${c.eco_activo !== 'false' ? 'selected' : ''}>Activados</option><option value="false" ${c.eco_activo === 'false' ? 'selected' : ''}>Pausados</option></select>
      <span></span><div><button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>Guardar ajustes</button></div>
    </form>`, `${srcTag(isLive())}<span class="agent">ECO</span>`)}`;
}
function integracionesPanel(){
  const d = D(), c = cfg(), ch = d.canales || {};
  const waOk = c.evolution_url && c.evolution_instancia && c.wa_destino_direccion;
  return panel('Integraciones', `<div class="tbl-wrap"><table><tbody>
      <tr><td><b>Plataforma ↔ n8n ↔ Postgres</b><div class="muted small">Flujo «R4 · API»</div></td><td>${!isLive() ? pill('Demostración') : live.error ? pill('Error','crit') : pill('Conectado','ok')}</td></tr>
      <tr><td><b>Gmail · ECO</b><div class="muted small">${ch.ultimo_gmail ? 'Último correo ' + fmtFecha(ch.ultimo_gmail) : 'Sin correos: conectar la credencial Gmail en el flujo ECO'}</div></td><td>${ch.ultimo_gmail ? pill('Recibiendo','ok') : pill('Pendiente','warn')}</td></tr>
      <tr><td><b>WhatsApp · avisos</b><div class="muted small">${waOk ? 'Instancia ' + e2(c.evolution_instancia) + (ch.ultimo_aviso_wa ? ' · último aviso ' + fmtFecha(ch.ultimo_aviso_wa) : '') : 'Completa URL, instancia y número de Dirección'}</div></td><td>${waOk ? ((d.kpis || {}).errores_wa ? pill('Con errores','warn') : pill('Configurado','ok')) : pill('Pendiente','warn')}</td></tr>
      <tr><td><b>WhatsApp · ATLASR4</b><div class="muted small">${ch.ultimo_whatsapp ? 'Último mensaje ' + fmtFecha(ch.ultimo_whatsapp) : 'Webhook /webhook/atlasr4 de n8n'}</div></td><td>${ch.ultimo_whatsapp ? pill('Recibiendo','ok') : pill('Pendiente','warn')}</td></tr>
      <tr><td><b>AEAT</b><div class="muted small">Fase 1 · EUNOMÍA</div></td><td>${pill(VF[state.vfMode].label, VF[state.vfMode].badge)}</td></tr></tbody></table></div>`, srcTag(isLive()), true);
}

/* ---- 11 Hoja de ruta (Propuesta de desarrollo, 23 nov 2026) ---- */
const FASES = [
  {n:'0 · Base técnica', a:'2026-11-30', b:'2026-12-11', st:['En curso · v1 hecha','info'], d:'Stack, esquema Postgres, flujos n8n (API, ECO, ATLASR4) y plataforma en Vercel.'},
  {n:'1 · Facturación (EUNOMÍA)', a:'2026-12-01', b:'2026-12-23', st:['Esperando datos de R4','warn'], d:'Verifactu con interruptor, certificaciones, IVA 10 %/ISP, rectificativas. Necesita CIF, forma jurídica, certificado y series.'},
  {n:'2 · CRM y Gmail (ECO)', a:'2026-12-14', b:'2027-01-15', st:['Adelantada · v1 en marcha','ok'], d:'Ficha única, organizaciones, inmuebles con alerta IEE, ECO Gmail → WhatsApp, ATLAS en WhatsApp.'},
  {n:'3 · Presupuestos (DÉDALO)', a:'2027-01-11', b:'2027-02-05', st:['Planificada',''], d:'Catálogo de partidas, descompuestos, versiones, firma y paso a obra.'},
  {n:'4 · Planning y costes (KAIRÓS · HEFESTO)', a:'2027-02-01', b:'2027-03-12', st:['Planificada',''], d:'Gantt, cuadrillas, medios, plan de las 7:00, partes por WhatsApp y coste por periodo.'},
  {n:'5 · Control financiero (PLUTO)', a:'2027-03-08', b:'2027-03-31', st:['Planificada',''], d:'Cierre mensual, cobros por antigüedad, margen por obra y tesorería a 13 semanas.'}
];
const HITOS = [{n:'Verifactu obligatorio (sociedades)', f:'2027-01-01', c:'var(--cian)'}, {n:'Primer cierre mensual', f:'2027-04-05', c:'var(--plasma)'}];
const NECESITAMOS = [
  ['Razón social, CIF y domicilio fiscal', ''], ['Forma jurídica (sociedad o autónomo): fija la fecha de Verifactu', ''],
  ['Modo de facturación: con o sin VERI*FACTU, o SII', ''], ['Certificado electrónico de la empresa', ''],
  ['Series y último número de factura emitido', ''], ['Tarifas: coste/hora por categoría y tramo, partidas y alquileres', ''],
  ['Qué significa «rangos de tiempo»: periodos, tramos horarios o ambos', ''], ['Equipo: nombres, roles y teléfonos de encargados', ''],
  ['Número de WhatsApp del agente y cuenta Gmail a leer', 'now'], ['JSON del agente de WhatsApp (adjunto 1)', 'done'],
  ['Clientes, obras en curso y proveedores para la carga inicial', '']
];
views['hoja-de-ruta'] = () => {
  const t0 = Date.parse('2026-11-28'), t1 = Date.parse('2027-04-12'), span = t1 - t0;
  const pos = d => ((Date.parse(d) - t0) * 100 / span).toFixed(2);
  const meses = [['dic','2026-12-01'],['ene','2027-01-01'],['feb','2027-02-01'],['mar','2027-03-01'],['abr','2027-04-01']];
  const hoy = Math.max(0, Math.min(100, Number(pos(new Date().toISOString().slice(0,10))))).toFixed(2);
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'short'});
  const grid = meses.map(([,d]) => `<i class="rm-grid" style="left:${pos(d)}%"></i>`).join('');
  const rows = FASES.map(f => `<div class="rm-row"><div class="rm-name"><b>${f.n}</b><span class="small muted">${fmt(f.a)} – ${fmt(f.b)}</span></div><div class="rm-track">${grid}<i class="rm-today" style="left:${hoy}%"></i><span class="rm-bar ${f.st[1]}" style="left:${pos(f.a)}%;width:${(pos(f.b) - pos(f.a)).toFixed(2)}%"></span></div><div class="rm-st">${pill(f.st[0], f.st[1])}</div></div>`).join('');
  const hitos = HITOS.map(h => `<div class="rm-row"><div class="rm-name"><b>${h.n}</b><span class="small muted">${fmt(h.f)}</span></div><div class="rm-track">${grid}<i class="rm-mile" style="left:${pos(h.f)}%;background:${h.c};box-shadow:0 0 10px ${h.c}"></i></div><div class="rm-st"></div></div>`).join('');
  const head = `<div class="rm-row rm-head"><div class="rm-name"></div><div class="rm-track">${meses.map(([m,d]) => `<span class="rm-month" style="left:${pos(d)}%">${m}</span>`).join('')}<span class="rm-month rm-hoy" style="left:${hoy}%">hoy</span></div><div class="rm-st"></div></div>`;
  return `
  <div class="callout"><b>La facturación con Verifactu va primero</b> porque es la única fase con fecha legal: el 1 de enero de 2027 si R4 es sociedad. Si R4 es autónomo, o si se publica en el BOE el aplazamiento a 2028, el CRM con Gmail pasa delante. Cada fase termina con R4 usándola en una obra real antes de abrir la siguiente.</div>
  ${panel('Plan por fases · diciembre 2026 a abril 2027', `<div class="tbl-wrap"><div class="rm">${head}${rows}${hitos}</div></div>
    <ul class="steps" style="margin-top:14px">${FASES.map(f => `<li><span class="st ${f.st[1] === 'ok' || f.st[1] === 'info' ? 'now' : ''}"></span><span><b>${f.n}</b><br><span class="muted small">${esc(f.d)}</span></span><span></span></li>`).join('')}</ul>`, '<span class="src demo">Propuesta 23 nov</span>')}
  <div class="grid g-2">
    ${panel('Lo que necesitamos de R4', `<ul class="steps">${NECESITAMOS.map(([t, st], i) => `<li><span class="st ${st === 'done' ? 'done' : st === 'now' ? 'now' : ''}"></span><span>${i < 4 ? '<b>' + esc(t) + '</b>' : esc(t)}</span><span class="small muted">${st === 'done' ? 'Recibido' : st === 'now' ? 'En curso' : 'Pendiente'}</span></li>`).join('')}</ul>
      <p class="note" style="margin-top:10px">Sin los cuatro primeros no se puede emitir la primera factura.</p>`)}
    ${panel('Decisiones abiertas', `<ul class="steps">
      <li><span class="st"></span><span>Quién de R4 aprueba presupuestos y cierra el mes.</span><span></span></li>
      <li><span class="st"></span><span>Si el cliente ve su diario fotográfico en el portal.</span><span></span></li>
      <li><span class="st"></span><span>IA de los agentes: la propuesta indica Claude; la v1 usa OpenAI (credencial ya existente en n8n).</span><span></span></li>
      <li><span class="st"></span><span>Acceso del equipo con cuenta de Google (la v1 usa contraseña de Dirección).</span><span></span></li>
      <li><span class="st"></span><span>Si «rangos de tiempo» son periodos de imputación, tramos horarios o ambos.</span><span></span></li></ul>`)}
  </div>`;
};

views['mission-control'] = vistaMission;
views['crm'] = vistaCRM;
views['bandeja'] = vistaBandeja;
views['atlas'] = vistaAtlas;

/* ---------- Punto de información por sección (como en Ágora Hispana) ---------- */
const INFO = {
  'mission-control':'Estado de R4 de un vistazo: mensajes del día, avisos de WhatsApp, oportunidades, alertas IEE y el mapa de conexiones en tiempo real entre Gmail, WhatsApp, n8n, la IA, Postgres y la plataforma.',
  'crm':'Ficha única de cada cliente, como en Contactos de Apple: busca, abre la ficha y actúa con un toque (WhatsApp, llamar, email). En Embudo mueves oportunidades arrastrando con el dedo; en Inmuebles controlas la alerta IEE.',
  'bandeja':'Todo lo que entra por Gmail (ECO) y WhatsApp (ATLAS). ECO resume cada correo, extrae los datos del cliente y los envía al WhatsApp de Dirección. Aquí puedes corregirlos o reenviarlos.',
  'presupuestos':'Fase 3 · DÉDALO propone partidas del catálogo de R4 a partir de fotos y mediciones; el técnico ajusta y Dirección aprueba. Datos de ejemplo.',
  'obras':'Fase 4 · Ficha de obra con fases y diario fotográfico que el encargado envía por WhatsApp. Datos de ejemplo.',
  'planning':'Fase 4 · KAIRÓS reparte cuadrillas y medios y envía el plan de las 7:00 por WhatsApp. Datos de ejemplo.',
  'costes':'Fase 4 · HEFESTO imputa partes, albaranes y alquileres por obra, periodo y partida y avisa de desviaciones. Datos de ejemplo.',
  'facturacion':'Fase 1 · EUNOMÍA emite facturas y certificaciones con Verifactu; sin IA en el registro fiscal. Datos de ejemplo.',
  'finanzas':'Fase 5 · PLUTO prepara el cierre mensual, los cobros por antigüedad y la tesorería a 13 semanas. Datos de ejemplo.',
  'atlas':'Equipo de agentes de R4. ATLAS orquesta y habla por WhatsApp; ECO lee Gmail. El resto se activa por fases.',
  'configuracion':'Ajustes de ECO y WhatsApp (sin claves: las claves viven en n8n), modo de facturación, datos de la empresa y roles.',
  'hoja-de-ruta':'Plan por fases de la Propuesta de desarrollo, estado real de cada fase y lo que falta de R4 para avanzar.'
};

/* ---------- navegación y cabecera ---------- */
const nav = document.getElementById('nav');
nav.innerHTML = sections.map(s=>`<a href="#${s.id}" data-id="${s.id}"><span class="code">${s.code}</span><span class="name">${s.name}</span><span class="sub">${s.sub}</span></a>`).join('');
const currentSection = () => { const id = (location.hash || '').slice(1); return sections.find(s => s.id === id) || sections[0]; };

function updateChrome(){
  const sec = currentSection();
  const p = document.getElementById('src-pill');
  if (LIVE_SECTIONS.has(sec.id) && isLive()){ p.className = 'pill live'; p.textContent = 'En vivo · ' + fmtHora(live.at); p.title = 'Datos reales de Postgres vía n8n'; }
  else if (LIVE_SECTIONS.has(sec.id)){ p.className = 'pill sample'; p.textContent = live.authed && live.loading ? 'Cargando…' : 'Demostración'; p.title = 'Conecta los datos reales para ver esta sección en vivo'; }
  else if (sec.id === 'hoja-de-ruta'){ p.className = 'pill info'; p.textContent = 'Propuesta · 23 nov 2026'; p.title = 'R4 · Propuesta de desarrollo de la plataforma'; }
  else { p.className = 'pill sample'; p.textContent = 'Ejemplo · fase siguiente'; p.title = 'Esta sección se conecta a datos reales en su fase'; }
  const b = document.getElementById('auth-btn'); b.textContent = 'Conectar datos reales'; b.hidden = !!live.noBackend || live.authed;
  document.getElementById('plat-state').textContent = isLive() ? 'ATLAS y ECO conectados' : 'modo demostración';
  document.getElementById('plat-dot').className = 'dot' + (isLive() ? '' : ' off');
  document.getElementById('who').textContent = live.authed ? 'Dirección' : 'Invitado';
  document.getElementById('foot').textContent = isLive()
    ? 'Plataforma R4 v1.2 · Holocontrol. Mission Control, CRM, Bandeja, ATLAS y Configuración muestran datos reales (Gmail → ECO → Postgres). Presupuestos, Obras, Planning, Costes, Facturación y Finanzas siguen con datos de ejemplo hasta su fase.'
    : 'Plataforma R4 v1.2 · Holocontrol en modo demostración: clientes, obras e importes son de ejemplo. Los datos reales entran por Gmail (ECO) y WhatsApp (ATLAS) al conectar la sesión.';
}
function render(){
  const sec = currentSection();
  nav.querySelectorAll('a').forEach(a=>{ a.setAttribute('aria-current', a.dataset.id===sec.id ? 'page' : 'false'); });
  document.getElementById('crumb-code').textContent = sec.code;
  document.getElementById('crumb-name').textContent = sec.name;
  document.getElementById('crumb-sub').textContent = sec.sub;
  const b = document.getElementById('vf-badge'), m = VF[state.vfMode]; b.textContent = m.label; b.className = 'pill ' + m.badge;
  updateChrome();
  const focused = document.activeElement && document.activeElement.id;
  const caret = focused === 'crm-q' ? document.activeElement.selectionStart : null;
  document.getElementById('view').innerHTML = views[sec.id]();
  if (focused){ const f = document.getElementById(focused); if (f && f !== document.body){ f.focus({preventScroll:true}); if (caret != null && f.setSelectionRange) f.setSelectionRange(caret, caret); } }
}
window.addEventListener('hashchange', ()=>{ if (location.hash === '#acceso'){ showPortal(); return; } closeInfo(); render(); document.getElementById('view').focus({preventScroll:true}); window.scrollTo({top:0}); });
document.getElementById('today').textContent = new Date().toLocaleDateString('es-ES',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:TZ});

/* info y atrás */
let infoEl = null;
function closeInfo(){ if (infoEl){ infoEl.remove(); infoEl = null; document.getElementById('info-btn').setAttribute('aria-expanded', 'false'); } }
document.getElementById('info-btn').addEventListener('click', e => {
  e.stopPropagation(); if (infoEl){ closeInfo(); return; }
  const sec = currentSection(), r = e.currentTarget.getBoundingClientRect();
  infoEl = document.createElement('div'); infoEl.className = 'info-pop'; infoEl.setAttribute('role', 'dialog'); infoEl.setAttribute('aria-label', 'Qué es ' + sec.name);
  infoEl.innerHTML = `<b>${esc(sec.code + ' · ' + sec.name)}</b>${esc(INFO[sec.id] || sec.sub)}`;
  document.body.appendChild(infoEl);
  infoEl.style.top = (r.bottom + 10) + 'px'; infoEl.style.left = Math.max(16, Math.min(r.left, window.innerWidth - infoEl.offsetWidth - 16)) + 'px';
  e.currentTarget.setAttribute('aria-expanded', 'true');
});
document.addEventListener('click', e => { if (infoEl && !infoEl.contains(e.target)) closeInfo(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeInfo(); });
document.getElementById('back-btn').addEventListener('click', () => { if (history.length > 1) history.back(); else location.hash = '#mission-control'; });

/* ---------- Portal de acceso (como Ágora Hispana) ---------- */
const portalEl = document.getElementById('portal');
function showPortal(){
  const sinServidor = live.noBackend || live.configured === false;
  portalEl.innerHTML = `<div class="portal-in">
    <section class="panel portal-head"><div class="body">
      <img src="assets/r4-logo.svg" alt="R4 Rehabilitación de Estructuras" width="210" height="44">
      <span class="small muted">Plataforma R4 · ATLAS y ECO · Mallorca</span>
      <h2>Elige tu acceso</h2>
      <p>Un solo sistema para cada obra: del primer mensaje del cliente por Gmail o WhatsApp a la ficha, el presupuesto y la factura.</p>
    </div></section>
    <div class="portal-cards">
      <section class="panel portal-card"><div class="body">
        <span class="num">01</span><h3>Dirección</h3>
        <p>Panel central: Mission Control, CRM, Bandeja, agentes y hoja de ruta.</p>
        <button class="btn primary" type="button" id="portal-dir">${sinServidor ? 'Ver demostración' : 'Entrar'}</button>
        ${sinServidor ? '<span class="small muted">El acceso real se activa con la plataforma desplegada en Vercel.</span>' : ''}
      </div></section>
      <section class="panel portal-card"><div class="body">
        <span class="num">02</span><h3>Equipo y clientes</h3>
        <p>Encargados y clientes hablan con ATLAS por WhatsApp, sin instalar nada. El portal del cliente llega en la fase 2.</p>
        <button class="btn" type="button" id="portal-cli">Próximamente</button>
      </div></section>
    </div>
    <div class="portal-foot">${sinServidor ? '' : '<button type="button" id="portal-demo">Ver demostración sin conectar</button>'}</div>
    <p class="portal-note">R4 Rehabilitación de Estructuras · Carrer Bellavista-C 14, 07600 Arenal (Mallorca) · Desarrollado por A.R.E.S. I.A.</p>
  </div>`;
  portalEl.hidden = false; document.body.style.overflow = 'hidden';
  const f = document.getElementById('portal-dir'); if (f) f.focus();
}
function hidePortal(){ portalEl.hidden = true; document.body.style.overflow = ''; if (!location.hash || location.hash === '#acceso') location.hash = '#mission-control'; render(); }
function openLogin(){ lerr.hidden = true; if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); document.getElementById('login-pass').focus(); }
portalEl.addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.id === 'portal-dir'){ if (live.noBackend || live.configured === false) hidePortal(); else openLogin(); }
  if (t.id === 'portal-demo') hidePortal();
  if (t.id === 'portal-cli') toast('El portal del cliente llega en la fase 2; hoy los clientes hablan con ATLAS por WhatsApp.');
});

/* ---------- acceso ---------- */
const dlg = document.getElementById('login'), lerr = document.getElementById('login-err');
document.getElementById('auth-btn').addEventListener('click', openLogin);
document.getElementById('exit-btn').addEventListener('click', async () => {
  if (live.authed){ try { await api('/api/session', { method:'DELETE' }); } catch(e){} live.authed = false; live.data = null; toast('Sesión cerrada.'); }
  closeInfo(); history.replaceState(null, '', location.pathname + '#acceso'); render(); showPortal();
});
document.getElementById('login-cancel').addEventListener('click', () => dlg.close());
document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('login-submit'), pass = document.getElementById('login-pass');
  btn.disabled = true; lerr.hidden = true;
  try {
    await api('/api/session', { method:'POST', body: JSON.stringify({ password: pass.value }) });
    pass.value = ''; dlg.close(); live.authed = true; if (!portalEl.hidden) hidePortal(); toast('Conectado. Cargando datos reales…'); await loadData();
  } catch(err){
    lerr.textContent = err.status === 401 ? 'Contraseña incorrecta.' : err.status === 503 ? 'La plataforma aún no tiene configurado el acceso (variables de Vercel).' : 'No se pudo conectar: ' + err.message;
    lerr.hidden = false;
  }
  btn.disabled = false;
});

/* ---------- interacción ---------- */
const view = document.getElementById('view');
const avisos = {
  wa:'Aviso reenviado al agente de WhatsApp (demostración).',
  corregir:'Los campos pasarían a ser editables y la corrección queda en la ficha (demostración).',
  esCliente:'ECO procesaría el correo como cliente y crearía su ficha (demostración).',
  aprobar:'P-26-112 aprobado: se enviaría al cliente por email y WhatsApp (demostración).',
  version:'Guardado como versión 2 (demostración).'
};
const avisoEmitir = { verifactu:'Certificación emitida y enviada a la AEAT (demostración).', noverifactu:'Certificación emitida, firmada y registrada (demostración).', sii:'Certificación emitida y anotada para el SII (demostración).' };
const waMsg = r => r && r.wa_enviado === true ? 'Aviso enviado al WhatsApp de Dirección.' : r && r.wa_enviado === false ? 'El envío por WhatsApp falló: revisa Evolution API.' : r && r.enviar_wa === false ? 'Datos guardados. WhatsApp sin configurar: completa los ajustes en Configuración.' : 'Hecho.';
function moverEtapa(id, etapa){
  let motivo = '';
  if (etapa === 'perdido'){ try { motivo = window.prompt('Motivo de la pérdida (precio, plazo, sin respuesta…):', '') || ''; } catch (err) { motivo = ''; } }
  act({ op:'set_etapa', id, etapa, motivo }, etapa === 'perdido' ? 'Oportunidad marcada como perdida.' : 'Oportunidad movida a «' + ETAPA_LARGA[etapa] + '».');
}
view.addEventListener('click', e => {
  const t = e.target.closest('[data-msg],[data-iva],[data-period],[data-act],[data-live-msg],[data-lact],[data-inm-edit],[data-inm-cancel],[data-crm-tab],[data-cli],[data-step-opp],[data-open-msg],[data-open-cli]');
  if (!t) return;
  if (t.dataset.crmTab){ live.crmTab = t.dataset.crmTab; render(); return; }
  if (t.dataset.cli !== undefined){ live.cliId = t.dataset.cli; render(); if (window.innerWidth < 1100){ const f = document.getElementById('ficha'); if (f) f.scrollIntoView({behavior:'smooth', block:'start'}); } return; }
  if (t.dataset.stepOpp){ moverEtapa(Number(t.dataset.stepOpp), t.dataset.step); return; }
  if (t.dataset.openMsg){ live.msgId = Number(t.dataset.openMsg); location.hash = '#bandeja'; return; }
  if (t.dataset.openCli){ live.cliId = t.dataset.openCli; live.crmTab = 'contactos'; location.hash = '#crm'; return; }
  if (t.dataset.inmEdit){ live.editInm = Number(t.dataset.inmEdit); render(); const f = document.getElementById('inm-anio'); if (f) f.focus(); return; }
  if (t.hasAttribute('data-inm-cancel')){ live.editInm = null; render(); return; }
  if (t.dataset.liveMsg !== undefined){ live.msgId = Number(t.dataset.liveMsg); live.editing = false; render(); const b = view.querySelector(`[data-live-msg="${live.msgId}"]`); if (b) b.focus(); return; }
  if (t.dataset.lact){
    const id = live.msgId, a = t.dataset.lact;
    if (a === 'editar'){ live.editing = true; render(); const f = document.getElementById('ed-nombre'); if (f) f.focus(); return; }
    if (a === 'cancelar'){ live.editing = false; render(); return; }
    if (a === 'refresh'){ loadData(); return; }
    if (a === 'reenviar') return act({ op:'reenviar_wa', id }, waMsg);
    if (a === 'cliente') return act({ op:'marcar_cliente', id }, waMsg);
    if (a === 'ignorar') return act({ op:'marcar_ignorado', id }, 'Marcado como no cliente.');
    return;
  }
  if (t.dataset.msg !== undefined){ state.msg = Number(t.dataset.msg); render(); return; }
  if (t.dataset.iva){ state.iva = t.dataset.iva; render(); return; }
  if (t.dataset.period){ state.period = t.dataset.period; render(); return; }
  const actn = t.dataset.act;
  toast(actn === 'emitir' ? avisoEmitir[state.vfMode] : (avisos[actn] || ''));
});
view.addEventListener('input', e => { if (e.target.id === 'crm-q'){ live.q = e.target.value; render(); } });
view.addEventListener('change', e => {
  if (e.target.name === 'vfmode'){ state.vfMode = e.target.value; store.set('vfMode', state.vfMode); render(); toast('Modo de facturación: ' + VF[state.vfMode].label + '.'); const r0 = document.getElementById('vf-'+state.vfMode); if (r0) r0.focus(); return; }
  if (e.target.dataset.etapaFor) moverEtapa(Number(e.target.dataset.etapaFor), e.target.value);
});
view.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target, fd = new FormData(f);
  if (f.id === 'edit-form'){ const extraccion = {}; EDITABLES.forEach(c => { extraccion[c] = String(fd.get(c) || '').trim(); }); act({ op:'update_extraccion', id: live.msgId, extraccion }, 'Datos corregidos.'); }
  if (f.id === 'inm-form'){ const id = Number(f.dataset.id); Promise.resolve(act({ op:'update_inmueble', id, anio_construccion: String(fd.get('anio_construccion') || '').trim(), tipo_estructura: String(fd.get('tipo_estructura') || '').trim(), iee_fecha: String(fd.get('iee_fecha') || '').trim() }, 'Inmueble actualizado.')).then(() => { live.editInm = null; render(); }); return; }
  if (f.id === 'cfg-form'){ const config = { evolution_url: String(fd.get('evolution_url') || '').trim().replace(/\/+$/, ''), evolution_instancia: String(fd.get('evolution_instancia') || '').trim(), wa_destino_direccion: String(fd.get('wa_destino_direccion') || '').trim(), wa_campos: fd.getAll('wa_campos').join(','), gmail_cuenta: String(fd.get('gmail_cuenta') || '').trim(), plataforma_url: String(fd.get('plataforma_url') || '').trim().replace(/\/+$/, ''), eco_activo: String(fd.get('eco_activo') || 'true') }; act({ op:'set_config', config }, 'Ajustes guardados.'); }
});

/* ---------- Embudo táctil: arrastrar con el asa (dedo, lápiz o ratón) ---------- */
let drag = null;
view.addEventListener('pointerdown', e => {
  const g = e.target.closest('[data-drag]'); if (!g) return;
  const card = g.closest('.deal'); if (!card) return;
  e.preventDefault(); g.setPointerCapture(e.pointerId);
  const ghost = card.cloneNode(true); ghost.classList.add('drag-ghost'); ghost.querySelectorAll('select,label').forEach(x => x.remove());
  document.body.appendChild(ghost);
  drag = { id: Number(g.dataset.drag), ghost, from: card.closest('[data-col]').dataset.col, over: null, pid: e.pointerId };
  card.style.opacity = '.35'; moveGhost(e);
});
function moveGhost(e){
  if (!drag) return;
  drag.ghost.style.left = (e.clientX - 110) + 'px'; drag.ghost.style.top = (e.clientY - 24) + 'px';
  const el = document.elementFromPoint(e.clientX, e.clientY); const col = el && el.closest('[data-col]');
  view.querySelectorAll('.col.drop-on').forEach(c => c.classList.remove('drop-on'));
  if (col){ col.classList.add('drop-on'); drag.over = col.dataset.col; } else drag.over = null;
}
view.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.pid) moveGhost(e); });
const endDrag = e => {
  if (!drag || (e && e.pointerId !== drag.pid)) return;
  const { id, over, from, ghost } = drag; ghost.remove(); drag = null;
  view.querySelectorAll('.col.drop-on').forEach(c => c.classList.remove('drop-on'));
  if (over && over !== from) moverEtapa(id, over); else render();
};
view.addEventListener('pointerup', endDrag); view.addEventListener('pointercancel', endDrag);

/* ---------- Cristal que responde al toque ---------- */
document.addEventListener('pointermove', e => {
  const el = e.target.closest && e.target.closest('.btn,.panel,.kpi,.node-card,.deal,.agent-card'); if (!el) return;
  const r = el.getBoundingClientRect(); if (!r.width) return;
  el.style.setProperty('--px', ((e.clientX - r.left) * 100 / r.width).toFixed(1) + '%');
  el.style.setProperty('--py', ((e.clientY - r.top) * 100 / r.height).toFixed(1) + '%');
}, { passive: true });
document.addEventListener('pointerdown', e => {
  const el = e.target.closest && e.target.closest('.btn,.kpi,.node-card,.deal,.agent-card'); if (!el) return;
  el.style.setProperty('--toque', '1'); setTimeout(() => el.style.setProperty('--toque', '0'), 240);
}, { passive: true });

/* ---------- arranque y refresco ---------- */
render();
checkSession().then(() => {
  if (live.authed){ if (location.hash === '#acceso') location.hash = '#mission-control'; loadData(); return; }
  render();
  if (!location.hash || location.hash === '#acceso') showPortal();
});
setInterval(() => { if (live.authed && !live.busy && !live.editing && !drag && document.visibilityState === 'visible' && document.activeElement.id !== 'crm-q') loadData(true); }, 60000);
})();
