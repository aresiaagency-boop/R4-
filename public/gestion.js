/* R4 · Gestión v1.5 — Equipo y Clientes
   Notas de voz del 24 nov (docs/NOTAS_VOZ_2026-11-24.md): obras con código, cuadrilla, partes de personal,
   modificaciones y extensiones, costes directos e indirectos, almacén, certificaciones, presupuestos estándar,
   planning de cuadrillas y portal del cliente. Usa el puente window.R4 que expone app.js. */
(() => {
'use strict';
const R = window.R4; if (!R) return;
const { views, INFO, live, act, panel, pill, esc, e2, eur, eur2, toast, render, fmtFecha, srcTag, liveBanner, isLive, rolActual, rolNom } = R;
const D = () => R.D();
const view = document.getElementById('view');

/* ---------- utilidades ---------- */
const hoyISO = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const fmtD = (s) => !s ? '—' : new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDc = (s) => !s ? '—' : new Date(String(s).slice(0, 10) + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const num = (v) => Number(v || 0);
const n1 = (v) => num(v).toLocaleString('es-ES', { maximumFractionDigits: 1 });
const pc = (v) => v == null || Number.isNaN(Number(v)) ? '—' : n1(v) + ' %';
const numES = (v) => {
  if (typeof v === 'number') return v;
  let x = String(v ?? '').trim().replace(/\s|€/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g, '').replace(',', '.'); else x = x.replace(',', '.');
  return x === '' ? NaN : Number(x);
};
// «3x3,20» · «3*3.2» · «9,6» → número
const cantidad = (txt) => String(txt || '').split(/[x×*]/i).map(numES).reduce((a, b) => a * b, 1);
function laborables(d, n) {
  if (!d) return null;
  const x = new Date(d + 'T12:00:00'); let k = 1; const total = Math.max(1, Math.ceil(num(n)));
  while (x.getDay() === 0 || x.getDay() === 6) x.setDate(x.getDate() + 1);
  while (k < total) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) k++; }
  return iso(x);
}
const siguienteLaborable = (d) => laborables(addDias(d, 1), 1);
const MATRIZ = {
  crm: ['direccion', 'tecnico', 'comercial', 'administracion'], ver_obras: ['direccion', 'tecnico', 'comercial', 'administracion', 'encargado', 'colaborador'],
  obras: ['direccion', 'tecnico', 'administracion'], partes: ['direccion', 'tecnico', 'administracion', 'encargado'],
  costes_obra: ['direccion', 'tecnico', 'administracion', 'encargado'], costes: ['direccion', 'administracion'], personal: ['direccion', 'administracion'],
  almacen: ['direccion', 'tecnico', 'administracion', 'encargado'], ver_presupuestos: ['direccion', 'tecnico', 'comercial', 'administracion'],
  presupuestos: ['direccion', 'tecnico', 'comercial'], precios: ['direccion', 'tecnico'], certificar: ['direccion', 'tecnico', 'administracion'],
  aprobar: ['direccion'], facturar: ['direccion'], config: ['direccion'], accesos: ['direccion']
};
const perm = (k) => isLive() ? !!((D().permisos || {})[k]) : (MATRIZ[k] || []).includes(rolActual());
const CAT = { material: 'Material', gasolina: 'Gasolina', mano_obra: 'Mano de obra', subcontrata: 'Subcontrata', alquiler: 'Alquiler', nomina_estructura: 'Nómina de estructura', seguro: 'Seguro', prevencion: 'Prevención de riesgos', oficina: 'Oficina', vehiculo: 'Vehículos', herramientas: 'Herramientas', otros: 'Otros' };
const CAT_DIR = ['material', 'gasolina', 'subcontrata', 'alquiler', 'mano_obra', 'otros'];
const CAT_IND = ['nomina_estructura', 'seguro', 'prevencion', 'oficina', 'vehiculo', 'herramientas', 'otros'];
const EST_OBRA = { planificada: ['Planificada', 'info'], en_curso: ['En curso', 'ok'], parada: ['Parada', 'warn'], terminada: ['Terminada', ''], facturada: ['Facturada', 'acc'] };
const EST_CERT = { borrador: ['Borrador', ''], enviada: ['Enviada al cliente', 'info'], conforme: ['Conforme · por facturar', 'ok'], facturada: ['Facturada', 'acc'] };
const EST_PRES = { borrador: ['Borrador', ''], enviado: ['Enviado', 'info'], aceptado: ['Aceptado · en Obras', 'ok'], rechazado: ['Rechazado', 'crit'] };
const CATOP = { oficial: 'Oficial', peon: 'Peón', encargado: 'Encargado' };
const ui = { obraId: null, obraTab: 'parte', soloCurso: true, costesTab: 'resumen', presId: null, draft: null, eqTab: 'accesos', parteFecha: hoyISO(), excel: null, ia: null, iaBusy: false, nuevaObra: false };
const opts = (pairs, sel) => pairs.map(([v, t]) => `<option value="${e2(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('');
const obraOpts = (sel, vacio = 'Sin obra (general)') => opts([['', vacio], ...(D().obras || []).map((o) => [o.id, o.codigo + ' · ' + o.titulo])], sel);
const clienteOpts = (sel) => opts([['', 'Sin cliente'], ...R.clientesDe(D()).map((c) => [c.id, (c.nombre || c.empresa || 'Cliente') + (c.empresa && c.empresa !== c.nombre ? ' · ' + c.empresa : '')])], sel);
const obraDe = (id) => (D().obras || []).find((o) => String(o.id) === String(id));
const opDe = (id) => (D().operarios || []).find((o) => String(o.id) === String(id));
const segs = (name, cur, items) => `<div class="seg" role="group">${items.map(([v, t]) => `<button type="button" aria-pressed="${v === cur}" data-${name}="${v}">${esc(t)}</button>`).join('')}</div>`;
const etiqueta = (o) => { const p = [o.codigo]; (o.lineas || []).forEach((l) => { if (l.linea === 0 && l.version > 0) p.push('mod ' + l.version); if (l.linea > 0) p.push('ext ' + l.linea + (l.version > 0 ? ' mod ' + l.version : '')); }); return p.join(' · '); };
const pctCI = () => { const k = D().kpis_costes; return k ? (k.pct_ci != null ? num(k.pct_ci) : num(k.umbral_ci)) : null; };
const cuad = (o) => `${num(o.oficiales)} oficial${num(o.oficiales) === 1 ? '' : 'es'} + ${num(o.peones)} peón${num(o.peones) === 1 ? '' : 'es'}`;
const vacio = (t) => `<p class="muted" style="margin:0">${t}</p>`;

/* ---------- DEMO coherente con el modelo real ---------- */
const DEMO = R.DEMO;
(() => {
  const hoy = hoyISO(), lunes = (() => { const d = new Date(hoy + 'T12:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); })();
  DEMO.config = Object.assign({ ventas_anuales_ref: '1150000', objetivo_beneficio: '20', umbral_ci: '15', coste_jornada_oficial: '150', coste_jornada_peon: '120', dias_nomina: '21', correo_materiales: '' }, DEMO.config);
  DEMO.operarios = [
    { id: 1, nombre: 'Andrés Ruiz', categoria: 'oficial', coste_mensual: 3150, telefono: '', activo: true },
    { id: 2, nombre: 'Miguel Ferrer', categoria: 'oficial', coste_mensual: 3050, telefono: '', activo: true },
    { id: 3, nombre: 'Pau Riera', categoria: 'oficial', coste_mensual: 3100, telefono: '', activo: true },
    { id: 4, nombre: 'Iván Moll', categoria: 'peon', coste_mensual: 2520, telefono: '', activo: true },
    { id: 5, nombre: 'Toni Serra', categoria: 'peon', coste_mensual: 2480, telefono: '', activo: true },
    { id: 6, nombre: 'Joan Vidal', categoria: 'encargado', coste_mensual: 3600, telefono: '', activo: true }
  ];
  DEMO.obras = [
    { id: 1, codigo: '36', titulo: 'Mecanovigas en forjado de garaje', cliente_id: 5, ubicacion: "C/ Neptú 12, s'Arenal", estado: 'en_curso', fecha_inicio: addDias(lunes, -14), oficiales: 2, peones: 1, periodo_control: 'semanal', presupuesto_url: '', notas: 'Acceso por rampa del garaje.', created_at: addDias(lunes, -20),
      lineas: [{ linea: 0, version: 1, importe: 45000, jornadas: 45, material: 15000, motivo: 'Medición en obra: 80 mecanovigas en vez de 100' }, { linea: 1, version: 0, importe: 3200, jornadas: 3, material: 900, motivo: 'Extra: apuntalamiento adicional en rampa' }],
      certificaciones: [{ id: 1, numero: 1, tipo: 'parcial', fecha: addDias(lunes, -3), importe: 18000, estado: 'enviada', notas: 'Mecanovigas ejes 1 a 4' }] },
    { id: 2, codigo: '31', titulo: 'Reparación de pilares con aluminosis', cliente_id: 3, ubicacion: 'C/ Son Ferriol 8, Palma', estado: 'en_curso', fecha_inicio: addDias(lunes, -28), oficiales: 2, peones: 1, periodo_control: 'semanal', presupuesto_url: '', notas: '', created_at: addDias(lunes, -35),
      lineas: [{ linea: 0, version: 0, importe: 48600, jornadas: 51, material: 14000, motivo: 'Presupuesto original' }],
      certificaciones: [{ id: 2, numero: 1, tipo: 'parcial', fecha: addDias(lunes, -14), importe: 14800, estado: 'facturada' }, { id: 3, numero: 2, tipo: 'parcial', fecha: addDias(lunes, -1), importe: 12000, estado: 'enviada' }] },
    { id: 3, codigo: '38', titulo: 'Refuerzo de pilar para reforma de local', cliente_id: 4, ubicacion: 'Palma', estado: 'planificada', fecha_inicio: addDias(lunes, 14), oficiales: 1, peones: 1, periodo_control: 'semanal', presupuesto_url: '', notas: '', created_at: addDias(lunes, -4),
      lineas: [{ linea: 0, version: 0, importe: 21700, jornadas: 12, material: 7000, motivo: 'Presupuesto 38 aceptado' }], certificaciones: [] },
    { id: 4, codigo: '29', titulo: 'Inyección contra humedad por capilaridad', cliente_id: 2, ubicacion: 'Llucmajor', estado: 'terminada', fecha_inicio: addDias(lunes, -42), oficiales: 1, peones: 1, periodo_control: 'semanal', presupuesto_url: '', notas: '', created_at: addDias(lunes, -50),
      lineas: [{ linea: 0, version: 0, importe: 9800, jornadas: 10, material: 2900, motivo: 'Presupuesto original' }],
      certificaciones: [{ id: 4, numero: 1, tipo: 'final', fecha: addDias(lunes, -6), importe: 9800, estado: 'conforme', conforme_por: 'Dirección (conformidad por teléfono)' }] }
  ];
  const partes = []; let pid = 1;
  const poner = (obra, desde, hasta, ops) => { for (let d = desde; d <= hasta; d = addDias(d, 1)) { const w = new Date(d + 'T12:00:00').getDay(); if (w === 0 || w === 6 || d > hoy) continue; ops.forEach((id) => partes.push({ id: pid++, obra_id: obra, fecha: d, operario_id: id, categoria: DEMO.operarios.find((o) => o.id === id).categoria, jornadas: 1 })); } };
  poner(1, addDias(lunes, -14), addDias(hoy, -1), [1, 2, 4]); poner(2, addDias(lunes, -28), addDias(lunes, -10), [3, 5, 6]); poner(4, addDias(lunes, -42), addDias(lunes, -33), [3, 5]);
  DEMO.partes = partes;
  DEMO.costes = [
    { id: 1, tipo: 'directo', categoria: 'material', obra_id: 1, concepto: 'Kit Mecanoviga 80 uds', proveedor: 'Mecanoviga', importe: 14500, fecha: addDias(lunes, -12), periodicidad: 'puntual', origen: 'pdf' },
    { id: 2, tipo: 'directo', categoria: 'alquiler', obra_id: 1, concepto: 'Alquiler de puntales', proveedor: 'Alquileres Llevant', importe: 1200, fecha: addDias(lunes, -13), periodicidad: 'puntual', origen: 'foto' },
    { id: 3, tipo: 'directo', categoria: 'gasolina', obra_id: 1, concepto: 'Tarjetas de combustible', proveedor: 'Estación de servicio', importe: 180, fecha: addDias(lunes, -2), periodicidad: 'puntual', origen: 'manual' },
    { id: 4, tipo: 'directo', categoria: 'material', obra_id: 2, concepto: 'Morteros de reparación y pasivador', proveedor: 'Sika', importe: 5200, fecha: addDias(lunes, -25), periodicidad: 'puntual', origen: 'pdf' },
    { id: 5, tipo: 'directo', categoria: 'material', obra_id: 4, concepto: 'Resinas de inyección', proveedor: 'Proveedor químico', importe: 2600, fecha: addDias(lunes, -40), periodicidad: 'puntual', origen: 'excel' },
    { id: 6, tipo: 'indirecto', categoria: 'seguro', obra_id: null, concepto: 'Seguro de responsabilidad civil', proveedor: 'Aseguradora', importe: 1200, fecha: addDias(lunes, -60), periodicidad: 'anual', origen: 'excel' },
    { id: 7, tipo: 'indirecto', categoria: 'seguro', obra_id: null, concepto: 'Seguro de convenio', proveedor: 'Aseguradora', importe: 900, fecha: addDias(lunes, -60), periodicidad: 'anual', origen: 'excel' },
    { id: 8, tipo: 'indirecto', categoria: 'prevencion', obra_id: null, concepto: 'Empresa de prevención de riesgos', proveedor: 'SPA', importe: 1000, fecha: addDias(lunes, -60), periodicidad: 'anual', origen: 'excel' },
    { id: 9, tipo: 'indirecto', categoria: 'nomina_estructura', obra_id: null, concepto: 'Nóminas de estructura (Dirección, técnico, encargado, secretaría)', proveedor: '', importe: 9800, fecha: addDias(lunes, -30), periodicidad: 'mensual', origen: 'excel' },
    { id: 10, tipo: 'indirecto', categoria: 'oficina', obra_id: null, concepto: 'Oficina, ordenadores y software', proveedor: '', importe: 950, fecha: addDias(lunes, -30), periodicidad: 'mensual', origen: 'manual' },
    { id: 11, tipo: 'indirecto', categoria: 'vehiculo', obra_id: null, concepto: 'Renting de furgonetas', proveedor: '', importe: 1100, fecha: addDias(lunes, -30), periodicidad: 'mensual', origen: 'manual' }
  ];
  DEMO.articulos = [
    { id: 1, nombre: 'Saco de mortero de reparación', unidad: 'saco', stock: 18, coste_unitario: 8.5, minimo: 10 },
    { id: 2, nombre: 'Puntal metálico 3 m', unidad: 'ud', stock: 40, coste_unitario: 22, minimo: 20 },
    { id: 3, nombre: 'Resina epoxi', unidad: 'kg', stock: 6, coste_unitario: 14, minimo: 10 },
    { id: 4, nombre: 'Malla de fibra de vidrio', unidad: 'm²', stock: 120, coste_unitario: 2.1, minimo: 30 }
  ];
  DEMO.movimientos = [
    { id: 1, articulo_id: 1, articulo: 'Saco de mortero de reparación', unidad: 'saco', tipo: 'salida', cantidad: 3, obra_id: 1, coste_unitario: 8.5, fecha: addDias(hoy, -1), origen: 'atlas', nota: 'Pedido por WhatsApp a ATLAS', created_by: 'encargado' },
    { id: 2, articulo_id: 3, articulo: 'Resina epoxi', unidad: 'kg', tipo: 'entrada', cantidad: 10, obra_id: null, coste_unitario: 14, fecha: addDias(hoy, -6), origen: 'manual', nota: '', created_by: 'secretaría' }
  ];
  DEMO.partidas = [
    { id: 1, codigo: 'MV-01', descripcion: 'Mecanoviga · refuerzo de vigueta (por metro de vigueta)', unidad: 'ml', precio: 95, material_pct: 55, jornadas_ud: 0.35, familia: 'Mecanoviga', activo: true, ejemplo: true },
    { id: 2, codigo: 'AP-01', descripcion: 'Apuntalamiento provisional de forjado', unidad: 'm²', precio: 12, material_pct: 25, jornadas_ud: 0.06, familia: 'Auxiliares', activo: true, ejemplo: true },
    { id: 3, codigo: 'VC-01', descripcion: 'Reparación de viga castellana', unidad: 'ml', precio: 140, material_pct: 35, jornadas_ud: 0.6, familia: 'Hormigón armado', activo: true, ejemplo: true },
    { id: 4, codigo: 'HA-01', descripcion: 'Reparación de hormigón armado (saneado, pasivado y mortero)', unidad: 'm²', precio: 85, material_pct: 30, jornadas_ud: 0.4, familia: 'Hormigón armado', activo: true, ejemplo: true },
    { id: 5, codigo: 'PI-01', descripcion: 'Encamisado de pilar', unidad: 'ud', precio: 1450, material_pct: 40, jornadas_ud: 3, familia: 'Refuerzo estructural', activo: true, ejemplo: true },
    { id: 6, codigo: 'AC-01', descripcion: 'Tratamiento anticarbonatación y protección de fachada', unidad: 'm²', precio: 28, material_pct: 35, jornadas_ud: 0.12, familia: 'Protección', activo: true, ejemplo: true },
    { id: 7, codigo: 'HU-01', descripcion: 'Inyección contra humedad por capilaridad', unidad: 'ml', precio: 65, material_pct: 45, jornadas_ud: 0.25, familia: 'Trabajos auxiliares', activo: true, ejemplo: true }
  ];
  DEMO.presupuestos = [
    { id: 1, codigo: '39', titulo: 'Mecanovigas y viga castellana · CP Son Ferriol', cliente_id: 3, ubicacion: 'C/ Son Ferriol 8, Palma', ajuste_pct: 20, estado: 'borrador', obra_id: null, origen: 'atlas', notas: 'Acceso complicado: +20 %. Dictado por WhatsApp a ATLAS.', created_at: addDias(hoy, -1), updated_at: addDias(hoy, -1),
      lineas: [{ partida_id: 1, descripcion: 'Mecanoviga · refuerzo de vigueta', unidad: 'ml', cantidad: 9.6, precio: 95, material_pct: 55, jornadas_ud: 0.35, cantidad_txt: '3x3,20' },
               { partida_id: 3, descripcion: 'Reparación de viga castellana', unidad: 'ml', cantidad: 8, precio: 140, material_pct: 35, jornadas_ud: 0.6 },
               { partida_id: 2, descripcion: 'Apuntalamiento provisional de forjado', unidad: 'm²', cantidad: 60, precio: 12, material_pct: 25, jornadas_ud: 0.06 }] },
    { id: 2, codigo: '38', titulo: 'Refuerzo de pilar para reforma de local', cliente_id: 4, ubicacion: 'Palma', ajuste_pct: 0, estado: 'aceptado', obra_id: 3, origen: 'plataforma', notas: '', created_at: addDias(hoy, -9), updated_at: addDias(hoy, -4),
      lineas: [{ partida_id: 5, descripcion: 'Encamisado de pilar', unidad: 'ud', cantidad: 4, precio: 1450, material_pct: 40, jornadas_ud: 3 }, { partida_id: 4, descripcion: 'Reparación de hormigón armado', unidad: 'm²', cantidad: 187, precio: 85, material_pct: 30, jornadas_ud: 0 }] }
  ];
  DEMO.usuarios = (DEMO.usuarios || []).concat([
    { email: 'presidencia.neptuno@correo.example', nombre: 'Joan Mas (CP Edificio Neptuno)', rol: 'pendiente', estado: 'pendiente', solicitud: 'cliente', cliente_sugerido: 5, accesos: 0, created_at: addDias(hoy, 0) },
    { email: 'secretaria@r4.example', nombre: 'Secretaría R4', rol: 'administracion', estado: 'activo', solicitud: 'equipo', aprobado_por: 'direccion@r4.example', accesos: 31, ultimo_acceso: addDias(hoy, 0), created_at: addDias(hoy, -8) }
  ]);
})();
function totalesPres(p) {
  const aj = 1 + num(p.ajuste_pct) / 100, l = p.lineas || [];
  const sub = l.reduce((a, x) => a + num(x.cantidad) * num(x.precio), 0);
  return { subtotal: sub, total: sub * aj, material: l.reduce((a, x) => a + num(x.cantidad) * num(x.precio) * num(x.material_pct) / 100, 0) * aj,
    jornadas: Math.round(l.reduce((a, x) => a + num(x.cantidad) * num(x.jornadas_ud), 0) * 10) / 10, sin_precio: l.filter((x) => !num(x.precio)).length };
}
const costeJornada = (o, cat) => { const c = DEMO.config; return o && o.coste_mensual ? num(o.coste_mensual) / num(c.dias_nomina || 21) : num(cat === 'peon' ? c.coste_jornada_peon : c.coste_jornada_oficial); };
function recalcDemo() {
  const d = DEMO, hoy = hoyISO();
  d.operarios.forEach((o) => { o.coste_jornada = Math.round(costeJornada(o, o.categoria) * 100) / 100; });
  d.obras.forEach((o) => {
    const vig = {}; (o.lineas || []).forEach((l) => { if (!vig[l.linea] || vig[l.linea].version < l.version) vig[l.linea] = l; });
    const lv = Object.values(vig).sort((a, b) => a.linea - b.linea); o.lineas = lv;
    o.importe = lv.reduce((a, l) => a + num(l.importe), 0); o.jornadas_presupuesto = lv.reduce((a, l) => a + num(l.jornadas), 0); o.material_presupuesto = lv.reduce((a, l) => a + num(l.material), 0);
    const ps = d.partes.filter((p) => p.obra_id === o.id);
    o.jornadas_registradas = ps.reduce((a, p) => a + num(p.jornadas), 0);
    o.ultimo_parte = ps.map((p) => p.fecha).sort().pop() || null;
    o.coste_mo = Math.round(ps.reduce((a, p) => a + num(p.jornadas) * costeJornada(d.operarios.find((x) => x.id === p.operario_id), p.categoria), 0) * 100) / 100;
    const cs = d.costes.filter((c) => c.tipo === 'directo' && c.obra_id === o.id);
    o.coste_material = cs.filter((c) => c.categoria === 'material').reduce((a, c) => a + num(c.importe), 0);
    o.coste_gasolina = cs.filter((c) => c.categoria === 'gasolina').reduce((a, c) => a + num(c.importe), 0);
    o.coste_directo = Math.round((o.coste_mo + cs.reduce((a, c) => a + num(c.importe), 0)) * 100) / 100;
    o.margen_directo = o.importe > 0 ? Math.round((o.importe - o.coste_directo) * 1000 / o.importe) / 10 : null;
    const cuadrilla = Math.max(1, num(o.oficiales) + num(o.peones));
    o.avance = o.jornadas_presupuesto > 0 ? Math.round(o.jornadas_registradas * 1000 / o.jornadas_presupuesto) / 10 : 0;
    o.dias_previstos = Math.ceil(o.jornadas_presupuesto / cuadrilla);
    o.fecha_fin = laborables(o.fecha_inicio, o.jornadas_presupuesto / cuadrilla);
    const lim = { diario: 1, quincenal: 14 }[o.periodo_control] || 7;
    o.control_pendiente = o.estado === 'en_curso' && (!o.ultimo_parte || o.ultimo_parte < addDias(hoy, -lim));
    o.certificado = (o.certificaciones || []).filter((c) => ['conforme', 'facturada'].includes(c.estado)).reduce((a, c) => a + num(c.importe), 0);
    const c = (R.clientesDe(d).find((x) => String(x.id) === String(o.cliente_id)) || {}); o.cliente_nombre = c.nombre; o.cliente_empresa = c.empresa;
  });
  const ciMes = d.costes.filter((c) => c.tipo === 'indirecto').reduce((a, c) => a + (c.periodicidad === 'mensual' ? num(c.importe) : c.periodicidad === 'anual' ? num(c.importe) / 12 : 0), 0)
    + d.costes.filter((c) => c.tipo === 'indirecto' && c.periodicidad === 'puntual').reduce((a, c) => a + num(c.importe), 0) / 12;
  const cd = d.costes.filter((c) => c.tipo === 'directo').reduce((a, c) => a + num(c.importe), 0) + d.obras.reduce((a, o) => a + num(o.coste_mo), 0);
  const ve = num(d.config.ventas_anuales_ref) || d.obras.reduce((a, o) => a + num(o.certificado), 0);
  d.kpis_costes = { ci_mensual: Math.round(ciMes * 100) / 100, ci_anual: Math.round(ciMes * 1200) / 100, cd_12m: cd, ventas_12m: ve,
    pct_ci: ve > 0 ? Math.round(ciMes * 12 * 1000 / ve) / 10 : null, ratio_ci_cd: cd > 0 ? Math.round(ciMes * 12 * 100 / cd) / 100 : null,
    objetivo_beneficio: num(d.config.objetivo_beneficio || 20), umbral_ci: num(d.config.umbral_ci || 15), ventas_fuente: num(d.config.ventas_anuales_ref) ? 'referencia' : 'certificado_12m' };
  d.presupuestos.forEach((p) => { p.totales = totalesPres(p); p.cliente_nombre = (R.clientesDe(d).find((x) => String(x.id) === String(p.cliente_id)) || {}).nombre; });
  d.permisos = Object.fromEntries(Object.keys(MATRIZ).map((k) => [k, (MATRIZ[k] || []).includes(rolActual())]));
}
let nid = 1000;
recalcDemo();
R.demoHooks.push((p, d) => {
  const quien = rolNom(rolActual());
  const ok = (r) => { recalcDemo(); return r || {}; };
  switch (p.op) {
    case 'operario_set': if (p.id) Object.assign(d.operarios.find((o) => o.id === Number(p.id)) || {}, { nombre: p.nombre || undefined, categoria: p.categoria, coste_mensual: p.coste_mensual === '' ? null : Number(p.coste_mensual) });
      else d.operarios.push({ id: nid++, nombre: p.nombre, categoria: p.categoria || 'oficial', coste_mensual: p.coste_mensual ? Number(p.coste_mensual) : null, activo: true }); return ok();
    case 'obra_set': if (p.id) { const o = d.obras.find((x) => x.id === Number(p.id)); Object.assign(o, Object.fromEntries(Object.entries(p).filter(([k]) => !['op', 'id', 'importe', 'jornadas', 'material'].includes(k)))); o.oficiales = num(o.oficiales); o.peones = num(o.peones); }
      else d.obras.push({ id: nid++, codigo: p.codigo, titulo: p.titulo, cliente_id: p.cliente_id ? Number(p.cliente_id) : null, ubicacion: p.ubicacion, estado: p.estado || 'planificada', fecha_inicio: p.fecha_inicio || null, oficiales: num(p.oficiales || 2), peones: num(p.peones || 1), periodo_control: p.periodo_control || 'semanal', presupuesto_url: p.presupuesto_url || '', notas: p.notas || '', certificaciones: [], lineas: [{ linea: 0, version: 0, importe: num(p.importe), jornadas: num(p.jornadas), material: num(p.material), motivo: 'Presupuesto original' }] });
      return ok();
    case 'obra_version': { const o = d.obras.find((x) => x.id === Number(p.obra_id)); const lin = p.linea === 'nueva' ? Math.max(0, ...o.lineas.map((l) => l.linea)) + 1 : Number(p.linea || 0);
      const prev = o.lineas.find((l) => l.linea === lin); o.lineas = o.lineas.filter((l) => l.linea !== lin); o.lineas.push({ linea: lin, version: prev ? prev.version + 1 : 0, importe: num(p.importe), jornadas: num(p.jornadas), material: num(p.material), motivo: p.motivo }); return ok({ linea: lin }); }
    case 'parte_set': d.partes = d.partes.filter((x) => !(x.obra_id === Number(p.obra_id) && x.fecha === p.fecha));
      (p.operarios || []).forEach((x) => { const op = d.operarios.find((o) => o.id === Number(x.id)); d.partes.push({ id: nid++, obra_id: Number(p.obra_id), fecha: p.fecha, operario_id: Number(x.id), categoria: x.categoria || op.categoria, jornadas: num(x.jornadas || 1) }); });
      { const o = d.obras.find((x) => x.id === Number(p.obra_id)); if (o.estado === 'planificada' && (p.operarios || []).length) { o.estado = 'en_curso'; o.fecha_inicio = o.fecha_inicio || p.fecha; } } return ok({ operarios: (p.operarios || []).length });
    case 'coste_add': (p.costes || [p]).forEach((c) => d.costes.unshift({ id: nid++, tipo: c.tipo, categoria: c.categoria || 'otros', obra_id: c.obra_id ? Number(c.obra_id) : null, concepto: c.concepto, proveedor: c.proveedor, importe: num(c.importe), fecha: c.fecha || hoyISO(), periodicidad: c.periodicidad || 'puntual', origen: c.origen || 'manual', created_by: quien })); return ok({ insertados: (p.costes || [p]).length });
    case 'coste_del': d.costes = d.costes.filter((c) => c.id !== Number(p.id)); return ok();
    case 'articulo_set': if (p.id) Object.assign(d.articulos.find((a) => a.id === Number(p.id)), { nombre: p.nombre, unidad: p.unidad, coste_unitario: num(p.coste_unitario), minimo: num(p.minimo) });
      else d.articulos.push({ id: nid++, nombre: p.nombre, unidad: p.unidad || 'ud', stock: 0, coste_unitario: num(p.coste_unitario), minimo: num(p.minimo) }); return ok();
    case 'movimiento_add': { const a = d.articulos.find((x) => x.id === Number(p.articulo_id)); const cu = p.coste_unitario ? num(p.coste_unitario) : a.coste_unitario;
      a.stock += (p.tipo === 'entrada' ? 1 : -1) * num(p.cantidad); if (p.tipo === 'entrada' && p.coste_unitario) a.coste_unitario = cu;
      d.movimientos.unshift({ id: nid++, articulo_id: a.id, articulo: a.nombre, unidad: a.unidad, tipo: p.tipo, cantidad: num(p.cantidad), obra_id: p.obra_id ? Number(p.obra_id) : null, coste_unitario: cu, fecha: p.fecha || hoyISO(), origen: p.origen || 'manual', nota: p.nota, created_by: quien });
      if (p.tipo === 'salida') d.costes.unshift({ id: nid++, tipo: 'directo', categoria: 'material', obra_id: Number(p.obra_id), concepto: 'Almacén: ' + p.cantidad + ' ' + a.unidad + ' de ' + a.nombre, importe: Math.round(num(p.cantidad) * cu * 100) / 100, fecha: p.fecha || hoyISO(), origen: 'almacen', periodicidad: 'puntual' });
      return ok({ stock: a.stock, aviso: a.stock < 0 ? 'stock negativo: falta registrar una entrada' : null }); }
    case 'cert_set': { const o = d.obras.find((x) => x.id === Number(p.obra_id)); o.certificaciones.push({ id: nid++, numero: o.certificaciones.length + 1, tipo: p.tipo || 'parcial', fecha: p.fecha || hoyISO(), importe: num(p.importe), estado: 'borrador', notas: p.notas }); return ok(); }
    case 'cert_estado': case 'cert_conforme': { for (const o of d.obras) { const c = o.certificaciones.find((x) => x.id === Number(p.id)); if (c) { c.estado = p.estado || 'conforme'; if (c.estado === 'conforme') c.conforme_por = p.op === 'cert_conforme' ? 'Cliente (portal)' : 'Dirección'; if (c.tipo === 'final' && c.estado === 'conforme') o.estado = 'terminada'; if (c.tipo === 'final' && c.estado === 'facturada') o.estado = 'facturada'; } } return ok(); }
    case 'partida_set': { const x = d.partidas.find((y) => y.id === Number(p.id)); if (x) Object.assign(x, { precio: p.precio === '' ? null : num(p.precio), material_pct: num(p.material_pct), jornadas_ud: num(p.jornadas_ud), ejemplo: false }); return ok(); }
    case 'presupuesto_set': { let x = p.id ? d.presupuestos.find((y) => y.id === Number(p.id)) : null;
      if (!x) { x = { id: nid++, estado: 'borrador', origen: 'plataforma', created_at: new Date().toISOString() }; d.presupuestos.unshift(x); }
      Object.assign(x, { codigo: p.codigo || x.codigo, titulo: p.titulo || x.titulo, cliente_id: p.cliente_id ? Number(p.cliente_id) : null, ubicacion: p.ubicacion, ajuste_pct: num(p.ajuste_pct), notas: p.notas, updated_at: new Date().toISOString(),
        lineas: (p.lineas || []).map((l) => ({ ...l, cantidad: num(l.cantidad), precio: num(l.precio), material_pct: num(l.material_pct), jornadas_ud: num(l.jornadas_ud) })) });
      return ok({ id: x.id }); }
    case 'presupuesto_estado': { const x = d.presupuestos.find((y) => y.id === Number(p.id)); x.estado = p.estado;
      if (p.estado === 'aceptado') { const t = totalesPres(x); const id = nid++; d.obras.push({ id, codigo: x.codigo, titulo: x.titulo, cliente_id: x.cliente_id, ubicacion: x.ubicacion, estado: 'planificada', fecha_inicio: p.fecha_inicio || null, oficiales: 2, peones: 1, periodo_control: 'semanal', presupuesto_url: '', notas: '', certificaciones: [], lineas: [{ linea: 0, version: 0, importe: t.total, jornadas: t.jornadas, material: t.material, motivo: 'Presupuesto ' + x.codigo + ' aceptado' }] }); x.obra_id = id; }
      return ok({ obra_id: x.obra_id }); }
    default: return undefined;
  }
});

/* ---------- textos de ayuda (i) ---------- */
Object.assign(INFO, {
  'mi-jornada': 'Lo que te toca hoy según tu rol: partes de personal, control semanal de obras, facturas de material, almacén, certificaciones y presupuestos pendientes.',
  presupuestos: 'Presupuestos con partidas estándar (mecanoviga, viga castellana, apuntalamiento…) y ajuste en % por dificultad. Al aceptarlo, Dirección lo «cuelga» en Obras con su código. ATLAS podrá prepararlos por WhatsApp (texto, audio o foto del checklist).',
  obras: 'Ficha de cada obra con su código, presupuesto adjunto, cuadrilla (oficiales y peones) y fecha de inicio. El avance es la mano de obra registrada en los partes frente a la del presupuesto; la fecha de fin se calcula sola. Modificaciones (mod) y extensiones (ext): manda el último mod.',
  planning: 'Planning de cuadrillas: a la izquierda cada obra (código), arriba las fechas. Las barras salen de Obras (inicio + fin calculado) y se recalculan con cada modificación. Sirve para saber cuándo queda libre cada cuadrilla.',
  costes: 'Costes directos (mano de obra con nómina y Seguridad Social, material y gasolina) e indirectos (estructura, oficina, seguros, prevención). Beneficio real = margen sobre coste directo − % de coste indirecto. Ingesta: formulario, pegar desde Excel o leer PDF/foto con IA.',
  almacen: 'Material del almacén: entradas y salidas a obra. Cada salida se apunta como coste de material de su obra, aunque no haya factura.',
  facturacion: 'Certificaciones parciales y finales: borrador → enviada al cliente → conforme (el cliente la confirma en su portal o Dirección la marca) → facturada. Debajo, el modo de facturación VERI*FACTU (fase 1).',
  equipo: 'Accesos con Google (Dirección aprueba y asigna rol), personal de obra con su coste por jornada y clientes con acceso a su portal.'
});

/* ---------- 01 Mi jornada ---------- */
views['mi-jornada'] = () => {
  const d = D(), obras = d.obras || [], hoy = hoyISO(), rol = rolActual();
  const enCurso = obras.filter((o) => o.estado === 'en_curso');
  const conParteHoy = new Set((d.partes || []).filter((p) => String(p.fecha).slice(0, 10) === hoy).map((p) => p.obra_id));
  const t = [];
  if (perm('partes')) enCurso.filter((o) => !conParteHoy.has(o.id)).forEach((o) => t.push(['', `Parte de personal de hoy · obra ${o.codigo}`, o.titulo, `data-go-obra="${o.id}" data-obra-tab-go="parte"`, 'Poner parte']));
  obras.filter((o) => o.control_pendiente).forEach((o) => t.push(['warn', `Control ${o.periodo_control} pendiente · obra ${o.codigo}`, 'Último parte: ' + (o.ultimo_parte ? fmtD(o.ultimo_parte) : 'ninguno'), `data-go-obra="${o.id}" data-obra-tab-go="parte"`, 'Poner al día']));
  if (perm('certificar')) obras.forEach((o) => (o.certificaciones || []).filter((c) => c.estado === 'borrador').forEach((c) => t.push(['', `Enviar al cliente la certificación ${c.tipo} nº ${c.numero} · obra ${o.codigo}`, eur.format(c.importe), `data-go-obra="${o.id}" data-obra-tab-go="cert"`, 'Revisar'])));
  if (perm('facturar')) obras.forEach((o) => (o.certificaciones || []).filter((c) => c.estado === 'conforme').forEach((c) => t.push(['ok', `Facturar certificación ${c.tipo} nº ${c.numero} · obra ${o.codigo}`, eur.format(c.importe) + ' · ' + (c.conforme_por || 'conforme'), 'data-go="#facturacion"', 'Facturar'])));
  if (perm('almacen')) (d.articulos || []).filter((a) => num(a.stock) < num(a.minimo)).forEach((a) => t.push([num(a.stock) < 0 ? 'crit' : 'warn', `Reponer: ${a.nombre}`, `Stock ${n1(a.stock)} ${a.unidad} · mínimo ${n1(a.minimo)}`, 'data-go="#almacen"', 'Almacén']));
  if (perm('presupuestos')) (d.presupuestos || []).filter((p) => p.estado === 'borrador').forEach((p) => t.push(['', `Terminar presupuesto ${p.codigo}`, p.titulo, `data-go-pres="${p.id}"`, 'Abrir']));
  if (perm('precios')) { const n = (d.partidas || []).filter((x) => x.precio == null).length; if (n) t.push(['warn', `Fijar el precio de ${n} partida${n > 1 ? 's' : ''} estándar`, 'Sin precio no se puede presupuestar con ATLAS', 'data-go="#presupuestos"', 'Catálogo']); }
  if (perm('accesos')) (d.usuarios || []).filter((u) => u.estado === 'pendiente').forEach((u) => t.push(['warn', `Aprobar acceso de ${u.nombre || u.email}`, u.solicitud === 'cliente' ? 'Pide acceso como cliente' : 'Pide acceso como equipo', 'data-go="#equipo"', 'Revisar']));
  const u = live.user || {};
  const acciones = [
    perm('partes') && enCurso.length && [`data-go-obra="${enCurso[0].id}" data-obra-tab-go="parte"`, 'Parte de personal', 'Quién ha ido hoy a cada obra'],
    perm('costes_obra') && ['data-go="#costes" data-costes-tab-go="ingesta"', 'Factura de material', 'Formulario, Excel, PDF o foto'],
    perm('almacen') && ['data-go="#almacen"', 'Salida de almacén', 'Material a obra sin factura'],
    perm('presupuestos') && ['data-go-pres="nuevo"', 'Nuevo presupuesto', 'Partidas estándar + ajuste %'],
    ['data-go="#planning"', 'Planning', 'Cuándo queda libre cada cuadrilla']
  ].filter(Boolean);
  return `${liveBanner()}
  <section class="panel jornada-hola"><div class="body"><div><span class="small muted">${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })}</span>
    <h2>Hola${u.nombre ? ', ' + e2(String(u.nombre).split(' ')[0]) : ''}</h2><p class="muted" style="margin:0">${esc(rolNom(rol))} · ${t.length ? t.length + ' tarea' + (t.length > 1 ? 's' : '') + ' pendientes' : 'todo al día'}</p></div>
    <div class="jornada-acc">${acciones.map(([a, tt, s]) => `<button class="btn tile" type="button" ${a}><b>${esc(tt)}</b><span>${esc(s)}</span></button>`).join('')}</div></div></section>
  <div class="grid g-3-1">
    ${panel('Tareas de hoy', t.length ? `<ul class="tareas">${t.map(([l, tt, s, a, b]) => `<li class="${l}"><span class="st ${l === 'ok' ? 'done' : 'now'}"></span><span><b>${esc(tt)}</b><span class="muted small" style="display:block">${esc(s)}</span></span><button class="btn" type="button" ${a}>${esc(b)}</button></li>`).join('')}</ul>` : vacio('No hay nada pendiente. Buen trabajo.'), srcTag(isLive()))}
    ${panel('Obras en curso', enCurso.length ? `<ul class="obras-mini">${enCurso.map((o) => `<li><button type="button" data-go-obra="${o.id}"><span class="codigo">${e2(o.codigo)}</span><span><b>${e2(o.titulo)}</b><span class="muted small" style="display:block">Fin previsto ${fmtD(o.fecha_fin)}${o.control_pendiente ? ' · control pendiente' : ''}</span>${R.prog(num(o.avance), num(o.avance) > 100 ? 'crit' : '')}</span></button></li>`).join('')}</ul>` : vacio('Sin obras en curso.'))}
  </div>`;
};

/* ---------- 05 Obras ---------- */
function filaObra(o) {
  const e = EST_OBRA[o.estado] || [o.estado, ''];
  return `<button class="crm-row obra-row" type="button" role="option" aria-selected="${String(o.id) === String(ui.obraId)}" data-obra="${o.id}"><span class="codigo">${e2(o.codigo)}</span><span style="min-width:0"><span class="nm">${e2(o.titulo)}</span><span class="sb">${e2([o.cliente_nombre || o.cliente_empresa, o.ubicacion].filter(Boolean).join(' · ') || '—')}</span></span><span class="obra-st">${pill(e[0], e[1])}<span class="small muted">${pc(o.avance)}</span></span></button>`;
}
views.obras = () => {
  const d = D(), todas = d.obras || [];
  const lista = ui.soloCurso ? todas.filter((o) => !['terminada', 'facturada'].includes(o.estado)) : todas;
  if (!ui.nuevaObra && (!ui.obraId || !obraDe(ui.obraId))) ui.obraId = (lista[0] || todas[0] || {}).id || null;
  const o = obraDe(ui.obraId);
  return `${liveBanner()}
  <div class="crm-shell obras-shell">
    <section class="panel crm-list"><header><h2>Obras</h2><div class="meta">${perm('obras') ? '<button class="btn primary" type="button" data-obra-nueva>+ Nueva obra</button>' : ''}</div></header><div class="body flush">
      <div class="seg-wrap">${segs('obras-filtro', ui.soloCurso ? 'curso' : 'todas', [['curso', 'Activas'], ['todas', 'Todas']])}</div>
      <div role="listbox" aria-label="Obras">${lista.length ? lista.map(filaObra).join('') : `<p class="muted" style="padding:16px">${perm('obras') ? 'Sin obras. Pulsa «+ Nueva obra» o acepta un presupuesto.' : 'Sin obras.'}</p>`}</div>
    </div></section>
    <div id="ficha-obra">${ui.nuevaObra ? formObra(null) : o ? fichaObra(o) : panel('Ficha de obra', vacio('Elige una obra.'))}</div>
  </div>`;
};
function fichaObra(o) {
  const e = EST_OBRA[o.estado] || [o.estado, ''], costes = 'margen_directo' in o, ci = pctCI();
  const real = costes && o.margen_directo != null && ci != null ? o.margen_directo - ci : null;
  const obj = num((D().kpis_costes || {}).objetivo_beneficio || 20);
  const tabs = [['parte', 'Parte diario'], ['pres', 'Presupuesto y mods'], ['costes', 'Costes'], ['cert', 'Certificaciones'], ['datos', 'Datos']];
  const cuerpo = { parte: tabParte, pres: tabPres, costes: tabCostesObra, cert: tabCerts, datos: () => formObra(o) }[ui.obraTab] || tabParte;
  return `<section class="panel"><div class="body obra-hero">
      <div class="obra-cab"><span class="codigo xl">${e2(o.codigo)}</span><div style="min-width:0"><h2>${e2(o.titulo)}</h2>
        <div class="muted">${e2(etiqueta(o))}${o.cliente_nombre ? ' · ' + e2(o.cliente_nombre) : ''}${o.ubicacion ? ' · ' + e2(o.ubicacion) : ''}</div>
        <div class="row" style="margin-top:8px">${pill(e[0], e[1])}${o.control_pendiente ? pill('Control ' + o.periodo_control + ' pendiente', 'warn') : ''}${o.presupuesto_url ? `<a class="btn" href="${e2(o.presupuesto_url)}" target="_blank" rel="noopener">Presupuesto (PDF)</a>` : ''}</div></div></div>
      <div class="kpis kpis-obra">
        <div class="kpi"><span class="l">Presupuesto vigente</span><span class="v">${eur.format(num(o.importe))}</span><span class="d">${n1(o.jornadas_presupuesto)} jornadas · material ${eur.format(num(o.material_presupuesto))}</span></div>
        <div class="kpi"><span class="l">Avance (mano de obra)</span><span class="v">${pc(o.avance)}</span><span class="d">${n1(o.jornadas_registradas)} de ${n1(o.jornadas_presupuesto)} jornadas</span></div>
        <div class="kpi"><span class="l">Inicio → fin previsto</span><span class="v" style="font-size:20px">${fmtDc(o.fecha_inicio)} → ${fmtDc(o.fecha_fin)}</span><span class="d">${o.dias_previstos || 0} días laborables · ${cuad(o)}</span></div>
        ${costes ? `<div class="kpi"><span class="l">Margen directo → beneficio real</span><span class="v">${pc(o.margen_directo)}</span><span class="d">Coste directo ${eur.format(num(o.coste_directo))}${real != null ? ' · real ' + pc(real) + (real < obj ? ' (objetivo ' + obj + ' %)' : '') : ''}</span></div>`
          : `<div class="kpi"><span class="l">Certificado</span><span class="v">${eur.format(num(o.certificado))}</span><span class="d">${(o.certificaciones || []).length} certificaciones</span></div>`}
      </div>
      <div class="seg-wrap">${segs('obra-tab', ui.obraTab, tabs)}</div>
    </div></section>
    ${cuerpo(o)}`;
}
function tabParte(o) {
  const d = D(), f = ui.parteFecha || hoyISO(), ops = (d.operarios || []).filter((x) => x.activo !== false);
  const delDia = (d.partes || []).filter((p) => p.obra_id === o.id && String(p.fecha).slice(0, 10) === f);
  const marcado = (id) => delDia.find((p) => p.operario_id === id);
  const grupos = ['oficial', 'peon', 'encargado'].map((c) => [c, ops.filter((x) => x.categoria === c)]).filter(([, l]) => l.length);
  const hist = {}; (d.partes || []).filter((p) => p.obra_id === o.id).forEach((p) => { const k = String(p.fecha).slice(0, 10); (hist[k] = hist[k] || []).push(p); });
  const dias = Object.keys(hist).sort().reverse().slice(0, 10);
  const form = perm('partes') ? `<form id="parte-form" data-obra="${o.id}" class="parte-form">
      <div class="row" style="gap:12px;align-items:end"><label class="small muted">Día<br><input type="date" name="fecha" value="${e2(f)}" max="${addDias(hoyISO(), 1)}" data-parte-fecha></label>
      <span class="muted small">Marca quién ha ido a la obra ${e2(o.codigo)} y si fue jornada completa o media.</span></div>
      ${ops.length ? grupos.map(([c, l]) => `<fieldset class="parte-grupo"><legend>${esc({ oficial: 'Oficiales', peon: 'Peones', encargado: 'Encargados' }[c])}</legend>${l.map((x) => { const m = marcado(x.id); return `<label class="parte-op ${m ? 'on' : ''}"><input type="checkbox" name="op" value="${x.id}" ${m ? 'checked' : ''}><span>${e2(x.nombre)}</span><select name="j-${x.id}" aria-label="Jornada de ${e2(x.nombre)}">${opts([['1', 'Jornada'], ['0.5', 'Media'], ['1.5', '+ extra']], m ? String(num(m.jornadas)) : '1')}</select></label>`; }).join('')}</fieldset>`).join('')
        : `<p class="muted">No hay personal de obra cargado. ${perm('personal') ? 'Añádelo en <a href="#equipo" data-eq-tab-go="personal">Equipo y clientes → Personal de obra</a>.' : 'Pídeselo a secretaría.'}</p>`}
      <div class="row" style="gap:10px"><button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>Guardar parte del ${esc(fmtD(f))}</button><span class="muted small">${delDia.length ? delDia.length + ' operarios ya apuntados ese día: se reemplaza.' : ''}</span></div>
    </form>` : vacio('Tu rol puede consultar los partes, no editarlos.');
  return `<div class="grid g-3-1">${panel('Parte de personal', form, o.control_pendiente ? pill('Control pendiente', 'warn') : srcTag(isLive()))}
    ${panel('Últimos partes', dias.length ? `<ul class="partes-hist">${dias.map((k) => `<li><b>${esc(fmtD(k))}</b><span>${hist[k].map((p) => { const x = opDe(p.operario_id) || {}; return e2(x.nombre || 'Operario') + ' <span class="muted">(' + esc((CATOP[p.categoria] || '').slice(0, 3).toLowerCase()) + (num(p.jornadas) !== 1 ? ' · ' + n1(p.jornadas) : '') + ')</span>'; }).join(', ')}</span></li>`).join('')}</ul>` : vacio('Todavía no hay partes.'), 'Últimas 6 semanas')}</div>`;
}
function tabPres(o) {
  const lineas = o.lineas || [];
  const form = perm('obras') ? `<form id="version-form" data-obra="${o.id}" class="form-grid">
      <label for="vf-linea">Qué cambia</label><select id="vf-linea" name="linea">${opts([...lineas.map((l) => [l.linea, l.linea === 0 ? `Presupuesto ${o.codigo} → mod ${l.version + 1}` : `Extensión ${l.linea} → mod ${l.version + 1}`]), ['nueva', `Nueva extensión (${o.codigo} ext ${Math.max(0, ...lineas.map((l) => l.linea)) + 1})`]], 0)}</select>
      <label for="vf-imp">Importe nuevo (€)</label><input id="vf-imp" name="importe" inputmode="decimal" required placeholder="45.000">
      <label for="vf-jor">Jornadas de mano de obra</label><input id="vf-jor" name="jornadas" inputmode="decimal" placeholder="27">
      <label for="vf-mat">Material (€)</label><input id="vf-mat" name="material" inputmode="decimal" placeholder="11.000">
      <label for="vf-mot">Motivo</label><input id="vf-mot" name="motivo" placeholder="Medición en obra: 80 mecanovigas en vez de 100">
      <span></span><div><button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>Guardar versión</button></div>
    </form>` : '';
  return `<div class="grid g-3-1">${panel('Presupuesto vigente', `<div class="tbl-wrap"><table><thead><tr><th>Línea</th><th>Vigente</th><th class="n">Importe</th><th class="n">Jornadas</th><th class="n">Material</th><th>Motivo</th></tr></thead><tbody>
      ${lineas.map((l) => `<tr><td><b>${l.linea === 0 ? 'Original' : 'Extensión ' + l.linea}</b></td><td>${esc(o.codigo + (l.linea ? ' ext ' + l.linea : '') + (l.version ? ' mod ' + l.version : ''))}</td><td class="n">${eur.format(num(l.importe))}</td><td class="n">${n1(l.jornadas)}</td><td class="n">${eur.format(num(l.material))}</td><td class="small">${e2(l.motivo || '')}</td></tr>`).join('')}
      <tr class="tot"><td colspan="2"><b>Total vigente</b></td><td class="n"><b>${eur.format(num(o.importe))}</b></td><td class="n"><b>${n1(o.jornadas_presupuesto)}</b></td><td class="n"><b>${eur.format(num(o.material_presupuesto))}</b></td><td></td></tr></tbody></table></div>`,
      'Manda el último mod de cada línea', true)}
    ${panel('Modificación o extensión', (form || vacio('Solo Dirección, técnico y secretaría cambian el presupuesto.')) + `<p class="muted small" style="margin:12px 0 0">Al guardar, el avance, la fecha de fin y el planning se recalculan solos. En el planning la obra sigue apareciendo como «${e2(o.codigo)}».</p>`)}</div>`;
}
function tabCostesObra(o) {
  const cs = (D().costes || []).filter((c) => String(c.obra_id) === String(o.id));
  const verCostes = 'coste_mo' in o;
  const form = perm('costes_obra') ? `<form id="coste-obra-form" data-obra="${o.id}" class="form-grid">
      <label for="co-cat">Tipo</label><select id="co-cat" name="categoria">${opts(CAT_DIR.filter((c) => c !== 'mano_obra').map((c) => [c, CAT[c]]), 'material')}</select>
      <label for="co-con">Concepto</label><input id="co-con" name="concepto" required placeholder="Factura de mortero, gasolina, alquiler…">
      <label for="co-pro">Proveedor</label><input id="co-pro" name="proveedor">
      <label for="co-imp">Importe sin IVA (€)</label><input id="co-imp" name="importe" inputmode="decimal" required>
      <label for="co-fec">Fecha</label><input id="co-fec" type="date" name="fecha" value="${hoyISO()}">
      <span></span><div class="row" style="gap:10px"><button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>Añadir a la obra ${e2(o.codigo)}</button><button class="btn" type="button" data-go="#costes" data-costes-tab-go="ingesta" data-ia-obra="${o.id}">Leer factura (PDF o foto) con IA</button></div>
    </form>` : '';
  return `<div class="grid g-3-1">${panel('Costes directos de la obra', `${verCostes ? `<div class="kpis kpis-mini"><div class="kpi"><span class="l">Mano de obra</span><span class="v">${eur.format(num(o.coste_mo))}</span><span class="d">${n1(o.jornadas_registradas)} jornadas × coste por nómina</span></div><div class="kpi"><span class="l">Material</span><span class="v">${eur.format(num(o.coste_material))}</span></div><div class="kpi"><span class="l">Gasolina</span><span class="v">${eur.format(num(o.coste_gasolina))}</span></div><div class="kpi"><span class="l">Total directo</span><span class="v">${eur.format(num(o.coste_directo))}</span><span class="d">Margen directo ${pc(o.margen_directo)}</span></div></div>` : ''}
      <div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Origen</th><th class="n">Importe</th></tr></thead><tbody>${cs.length ? cs.map((c) => `<tr><td class="small">${fmtDc(c.fecha)}</td><td>${esc(CAT[c.categoria] || c.categoria)}</td><td>${e2(c.concepto)}<div class="muted small">${e2(c.proveedor || '')}</div></td><td>${pill(c.origen)}</td><td class="n">${eur2.format(num(c.importe))}</td></tr>`).join('') : '<tr><td colspan="5" class="muted">Sin costes de material todavía.</td></tr>'}</tbody></table></div>`, srcTag(isLive()), true)}
    ${panel('Añadir factura o gasto', form || vacio('Tu rol no registra costes.'))}</div>`;
}
function tabCerts(o) {
  const cs = o.certificaciones || [], resto = num(o.importe) - cs.reduce((a, c) => a + num(c.importe), 0);
  const acciones = (c) => {
    const b = [];
    if (c.estado === 'borrador' && perm('certificar')) b.push(`<button class="btn" type="button" data-cert="${c.id}" data-cert-estado="enviada">Enviar al cliente</button>`);
    if (c.estado === 'enviada' && perm('facturar')) b.push(`<button class="btn" type="button" data-cert="${c.id}" data-cert-estado="conforme">Conforme (Dirección)</button>`);
    if (c.estado === 'enviada' && perm('certificar')) b.push(`<button class="btn" type="button" data-cert="${c.id}" data-cert-estado="borrador">Volver a borrador</button>`);
    if (c.estado === 'conforme' && perm('facturar')) b.push(`<button class="btn primary" type="button" data-cert="${c.id}" data-cert-estado="facturada">Marcar facturada</button>`);
    return b.join('');
  };
  const form = perm('certificar') ? `<form id="cert-form" data-obra="${o.id}" class="form-grid">
      <label for="ce-tipo">Tipo</label><select id="ce-tipo" name="tipo">${opts([['parcial', 'Parcial'], ['final', 'Final (cierre de obra)']], resto <= 0 ? 'final' : 'parcial')}</select>
      <label for="ce-imp">Importe (€)</label><input id="ce-imp" name="importe" inputmode="decimal" required placeholder="${resto > 0 ? n1(resto) : ''}">
      <label for="ce-fec">Fecha</label><input id="ce-fec" type="date" name="fecha" value="${hoyISO()}">
      <label for="ce-not">Notas</label><input id="ce-not" name="notas" placeholder="Partidas ejecutadas, extras…">
      <span></span><div><button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>Crear certificación</button></div>
    </form><p class="muted small" style="margin:12px 0 0">Pendiente de certificar: <b>${eur.format(Math.max(0, resto))}</b>. El cliente da su conformidad desde su portal; después se factura.</p>` : '';
  return `<div class="grid g-3-1">${panel('Certificaciones', cs.length ? `<ul class="certs">${cs.map((c) => { const e = EST_CERT[c.estado] || [c.estado, '']; return `<li><span class="codigo">${c.numero}</span><span><b>${c.tipo === 'final' ? 'Final' : 'Parcial'} · ${eur.format(num(c.importe))}</b><span class="muted small" style="display:block">${fmtD(c.fecha)}${c.conforme_por ? ' · conforme: ' + e2(c.conforme_por) : ''}${c.notas ? ' · ' + e2(c.notas) : ''}</span></span><span class="cert-acc">${pill(e[0], e[1])}${acciones(c)}</span></li>`; }).join('')}</ul>` : vacio('Sin certificaciones.'), `Certificado conforme ${eur.format(num(o.certificado))}`)}
    ${panel('Nueva certificación', form || vacio('Tu rol no crea certificaciones.'))}</div>`;
}
function formObra(o) {
  const n = !o, v = o || { periodo_control: 'semanal', oficiales: 2, peones: 1, estado: 'planificada' };
  if (!perm('obras')) return panel('Datos de la obra', `<dl class="fields"><dt>Código</dt><dd>${e2(v.codigo)}</dd><dt>Ubicación</dt><dd>${e2(v.ubicacion || '—')}</dd><dt>Periodo de control</dt><dd>${e2(v.periodo_control)}</dd><dt>Notas</dt><dd>${e2(v.notas || '—')}</dd></dl>`);
  return panel(n ? 'Nueva obra' : 'Datos de la obra', `<form id="obra-form" ${o ? `data-id="${o.id}"` : ''} class="form-grid">
    <label for="ob-cod">Código</label><input id="ob-cod" name="codigo" value="${e2(v.codigo || '')}" required maxlength="40" placeholder="36">
    <label for="ob-tit">Trabajo</label><input id="ob-tit" name="titulo" value="${e2(v.titulo || '')}" required placeholder="Mecanovigas en forjado de garaje">
    <label for="ob-cli">Cliente</label><select id="ob-cli" name="cliente_id">${clienteOpts(v.cliente_id)}</select>
    <label for="ob-ubi">Ubicación</label><input id="ob-ubi" name="ubicacion" value="${e2(v.ubicacion || '')}">
    <label for="ob-ini">Inicio</label><input id="ob-ini" type="date" name="fecha_inicio" value="${e2(v.fecha_inicio ? String(v.fecha_inicio).slice(0, 10) : '')}">
    <label>Cuadrilla</label><div class="row" style="gap:8px"><input name="oficiales" type="number" min="0" max="50" value="${num(v.oficiales)}" aria-label="Oficiales" style="width:90px"> oficiales <input name="peones" type="number" min="0" max="50" value="${num(v.peones)}" aria-label="Peones" style="width:90px"> peones</div>
    ${n ? `<label for="ob-imp">Importe del presupuesto (€)</label><input id="ob-imp" name="importe" inputmode="decimal" placeholder="48.000">
    <label for="ob-jor">Mano de obra (jornadas)</label><input id="ob-jor" name="jornadas" inputmode="decimal" placeholder="30">
    <span class="hint">Jornadas = operarios × días del presupuesto. Con la cuadrilla da la fecha de fin.</span>
    <label for="ob-mat">Material (€)</label><input id="ob-mat" name="material" inputmode="decimal" placeholder="12.000">` : ''}
    <label for="ob-est">Estado</label><select id="ob-est" name="estado">${opts(Object.entries(EST_OBRA).map(([k, x]) => [k, x[0]]), v.estado)}</select>
    <label for="ob-per">Periodo de control</label><select id="ob-per" name="periodo_control">${opts([['semanal', 'Semanal'], ['diario', 'Diario'], ['quincenal', 'Quincenal']], v.periodo_control)}</select>
    <label for="ob-url">Presupuesto adjunto (enlace PDF)</label><input id="ob-url" name="presupuesto_url" value="${e2(v.presupuesto_url || '')}" placeholder="https://drive.google.com/…" inputmode="url">
    <label for="ob-not">Notas</label><input id="ob-not" name="notas" value="${e2(v.notas || '')}">
    <span></span><div class="row" style="gap:10px"><button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>${n ? 'Abrir obra' : 'Guardar datos'}</button>${n ? '<button class="btn" type="button" data-obra-cancelar>Cancelar</button>' : ''}</div>
  </form>`);
}

/* ---------- 06 Planning de cuadrillas (Gantt) ---------- */
views.planning = () => {
  const d = D(), hoy = hoyISO();
  const lun = (() => { const x = new Date(hoy + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7) - 7); return iso(x); })();
  const N = 63, dias = Array.from({ length: N }, (_, i) => addDias(lun, i));
  const obras = (d.obras || []).filter((o) => o.fecha_inicio && o.estado !== 'facturada').sort((a, b) => String(a.fecha_inicio).localeCompare(String(b.fecha_inicio)));
  const idx = (s) => Math.round((new Date(String(s).slice(0, 10) + 'T12:00:00') - new Date(lun + 'T12:00:00')) / 864e5);
  const ultimoEquipo = (o) => { const ps = (d.partes || []).filter((p) => p.obra_id === o.id); const f = ps.map((p) => String(p.fecha).slice(0, 10)).sort().pop(); return f ? ps.filter((p) => String(p.fecha).slice(0, 10) === f).map((p) => (opDe(p.operario_id) || {}).nombre).filter(Boolean) : []; };
  const cab = dias.map((s) => { const x = new Date(s + 'T12:00:00'), w = x.getDay(); return `<span class="gd ${w === 0 || w === 6 ? 'fin' : ''} ${s === hoy ? 'hoy' : ''}" title="${esc(fmtD(s))}">${x.getDate() === 1 || s === lun || w === 1 ? `<b>${x.getDate()}</b>` : x.getDate()}</span>`; }).join('');
  const meses = []; dias.forEach((s, i) => { const m = new Date(s + 'T12:00:00').toLocaleDateString('es-ES', { month: 'long' }); if (!meses.length || meses[meses.length - 1][0] !== m) meses.push([m, i]); });
  const filas = obras.map((o) => {
    const a = idx(o.fecha_inicio), b = idx(o.fecha_fin || o.fecha_inicio), x0 = Math.max(0, a), x1 = Math.min(N - 1, b);
    const visible = b >= 0 && a < N, e = EST_OBRA[o.estado] || ['', ''];
    return `<div class="gr"><button type="button" class="gl" data-go-obra="${o.id}"><span class="codigo">${e2(o.codigo)}</span><span><b>${e2(o.titulo)}</b><span class="muted small" style="display:block">${o.oficiales} of. + ${o.peones} p. · ${esc(e[0])}</span></span></button>
      <div class="gt">${dias.map((s) => { const w = new Date(s + 'T12:00:00').getDay(); return `<span class="gc ${w === 0 || w === 6 ? 'fin' : ''} ${s === hoy ? 'hoy' : ''}"></span>`; }).join('')}
      ${visible ? `<span class="gb est-${e2(o.estado)}" style="left:calc(${x0} * var(--gw));width:calc(${x1 - x0 + 1} * var(--gw))" title="${e2(o.codigo)} · ${esc(fmtD(o.fecha_inicio))} → ${esc(fmtD(o.fecha_fin))}"><i style="width:${Math.min(100, num(o.avance))}%"></i><span>${e2(o.codigo)} · fin ${esc(fmtDc(o.fecha_fin))}</span></span>` : ''}</div></div>`;
  }).join('');
  const libres = obras.filter((o) => ['en_curso', 'planificada', 'parada'].includes(o.estado)).map((o) => ({ o, libre: siguienteLaborable(o.fecha_fin || o.fecha_inicio), eq: ultimoEquipo(o) })).sort((a, b) => String(a.libre).localeCompare(String(b.libre)));
  return `${liveBanner()}
  ${panel('Planning de cuadrillas', obras.length ? `<div class="gantt" style="--gw:24px"><div class="gr gh"><span class="gl muted small">Obra · presupuesto</span><div class="gt">${meses.map(([m, i]) => `<span class="gm" style="left:calc(${i} * var(--gw))">${esc(m)}</span>`).join('')}${cab}</div></div>${filas}</div>
    <div class="gantt-ley"><span><i class="est-en_curso"></i>En curso (relleno = avance)</span><span><i class="est-planificada"></i>Planificada</span><span><i class="est-parada"></i>Parada</span><span><i class="est-terminada"></i>Terminada</span><span><i class="hoy"></i>Hoy</span></div>`
    : vacio('Todavía no hay obras con fecha de inicio. Ábrelas en Obras con su cuadrilla y el planning se dibuja solo.'), srcTag(isLive()) + '<span class="muted small">Se recalcula con cada mod o extensión</span>', true)}
  ${panel('Cuándo queda libre cada cuadrilla', libres.length ? `<div class="tbl-wrap"><table><thead><tr><th>Obra</th><th>Cuadrilla</th><th>Último equipo en obra</th><th>Fin previsto</th><th>Libre desde</th></tr></thead><tbody>${libres.map(({ o, libre, eq }) => `<tr><td><b>${e2(o.codigo)}</b> · ${e2(o.titulo)}</td><td>${cuad(o)}</td><td class="small">${eq.length ? eq.map(e2).join(', ') : '<span class="muted">sin partes</span>'}</td><td>${fmtD(o.fecha_fin)}</td><td>${pill(fmtD(libre), 'ok')}</td></tr>`).join('')}</tbody></table></div>` : vacio('Sin cuadrillas asignadas.'), 'Para decir al cliente cuándo se puede empezar', true)}`;
};

/* ---------- 07 Costes ---------- */
views.costes = () => {
  if (!perm('costes_obra')) return panel('Costes', vacio('Tu rol no tiene acceso a costes.'));
  const d = D(), k = d.kpis_costes, cs = d.costes || [];
  if (!perm('costes') && !['ingesta'].includes(ui.costesTab)) ui.costesTab = 'directos';
  const tabs = perm('costes') ? [['resumen', 'Resumen'], ['directos', 'Directos'], ['indirectos', 'Indirectos'], ['personal', 'Personal y tarifas'], ['ingesta', 'Ingesta de datos']] : [['directos', 'Directos de obra'], ['ingesta', 'Añadir facturas']];
  const cuerpo = { resumen: costesResumen, directos: () => tablaCostes(cs.filter((c) => c.tipo === 'directo'), true), indirectos: costesIndirectos, personal: costesPersonal, ingesta: costesIngesta }[ui.costesTab] || costesResumen;
  return `${liveBanner()}${k ? kpisCostes(k) : ''}<div class="seg-wrap">${segs('costes-tab', ui.costesTab, tabs)}</div>${cuerpo()}`;
};
function kpisCostes(k) {
  const ci = k.pct_ci, um = num(k.umbral_ci || 15), obj = num(k.objetivo_beneficio || 20), ref = ci != null ? num(ci) : um;
  return `<div class="kpis">
    <div class="kpi"><span class="l">Coste indirecto mensual</span><span class="v">${eur.format(num(k.ci_mensual))}</span><span class="d">${eur.format(num(k.ci_anual))} al año · fijos prorrateados</span></div>
    <div class="kpi"><span class="l">% indirecto sobre ventas</span><span class="v">${ci != null ? pc(ci) : '—'}</span><span class="d">${ci == null ? 'Pon la facturación anual de referencia en Tarifas' : (ci > um ? pill('Por encima del ' + um + ' %', 'crit') : pill('Dentro del ' + um + ' %', 'ok')) + ' ' + (k.ventas_fuente === 'referencia' ? 'sobre la facturación de referencia' : 'sobre lo certificado en 12 meses')}</span></div>
    <div class="kpi"><span class="l">Coste indirecto ÷ directo</span><span class="v">${k.ratio_ci_cd != null ? n1(k.ratio_ci_cd) : '—'}</span><span class="d">${k.ratio_ci_cd == null ? 'Sin costes directos aún' : num(k.ratio_ci_cd) > 0.5 ? pill('Mayor que 0,5', 'warn') : pill('Menor que 0,5', 'ok')}</span></div>
    <div class="kpi"><span class="l">Margen directo necesario</span><span class="v">${pc(obj + ref)}</span><span class="d">para ${obj} % de beneficio real (${obj} + ${n1(ref)} indirecto)</span></div>
  </div>`;
}
function costesResumen() {
  const d = D(), ci = pctCI(), obj = num((d.kpis_costes || {}).objetivo_beneficio || 20);
  const obras = (d.obras || []).filter((o) => num(o.importe) > 0);
  return `<div class="grid g-3-1">${panel('Beneficio real por obra', obras.length ? `<div class="tbl-wrap"><table class="tbl-obras"><thead><tr><th>Obra</th><th class="n">Presupuesto</th><th class="n">Coste directo</th><th class="n">Margen directo</th><th class="n">− Indirecto</th><th class="n">Beneficio real</th></tr></thead><tbody>${obras.map((o) => { const r = o.margen_directo != null && ci != null ? o.margen_directo - ci : null; return `<tr><td><b>${e2(o.codigo)}</b> · ${e2(o.titulo)}<div class="muted small">Avance ${pc(o.avance)}</div></td><td class="n">${eur.format(num(o.importe))}</td><td class="n">${eur.format(num(o.coste_directo))}</td><td class="n">${pc(o.margen_directo)}</td><td class="n">${pc(ci)}</td><td class="n">${r == null ? '—' : pill(pc(r), r >= obj ? 'ok' : r >= 0 ? 'warn' : 'crit')}</td></tr>`; }).join('')}</tbody></table></div>` : vacio('Aún no hay obras con presupuesto.'), 'Margen sobre coste directo − % de indirecto', true)}
    ${panel('Cómo se calcula', `<ul class="steps"><li><span class="st done"></span><span><b>Directo</b>: mano de obra (jornadas de los partes × coste por nómina con Seguridad Social), material, gasolina, alquileres y subcontratas de cada obra.</span></li>
      <li><span class="st done"></span><span><b>Indirecto</b>: nóminas de estructura, oficina, ordenadores, seguros y prevención. Los anuales se prorratean; los mensuales y anuales cuentan una vez por concepto (el importe más reciente).</span></li>
      <li><span class="st now"></span><span><b>Beneficio real</b> = margen directo − % indirecto. Si el indirecto supera el ${num((d.kpis_costes || {}).umbral_ci || 15)} %, hay que revisar estructura o precios.</span></li></ul>`)}</div>`;
}
function tablaCostes(cs, conObra) {
  return panel(conObra ? 'Costes directos' : 'Costes', `<div class="tbl-wrap"><table><thead><tr><th>Fecha</th>${conObra ? '<th>Obra</th>' : ''}<th>Categoría</th><th>Concepto</th><th>Origen</th><th class="n">Importe</th>${perm('costes') ? '<th></th>' : ''}</tr></thead><tbody>${cs.length ? cs.map((c) => { const o = obraDe(c.obra_id); return `<tr><td class="small">${fmtDc(c.fecha)}</td>${conObra ? `<td>${o ? `<b>${e2(o.codigo)}</b>` : '<span class="muted">General</span>'}</td>` : ''}<td>${esc(CAT[c.categoria] || c.categoria)}${c.periodicidad !== 'puntual' ? ' ' + pill(c.periodicidad) : ''}</td><td>${e2(c.concepto)}<div class="muted small">${e2(c.proveedor || '')}</div></td><td>${pill(c.origen)}</td><td class="n">${eur2.format(num(c.importe))}</td>${perm('costes') ? `<td>${borrarBtn(c.id)}</td>` : ''}</tr>`; }).join('') : `<tr><td colspan="7" class="muted">Sin datos. Usa «Ingesta de datos».</td></tr>`}</tbody></table></div>`, srcTag(isLive()), true);
}
const borrarBtn = (id) => { const on = ui.borrar === id; return `<button class="btn ${on ? 'danger' : ''}" type="button" data-coste-del="${id}">${on ? '¿Borrar? Toca otra vez' : 'Borrar'}</button>`; };
function costesIndirectos() {
  const cs = (D().costes || []).filter((c) => c.tipo === 'indirecto');
  const porCat = {}; cs.forEach((c) => { const m = c.periodicidad === 'mensual' ? num(c.importe) : c.periodicidad === 'anual' ? num(c.importe) / 12 : num(c.importe) / 12; porCat[c.categoria] = (porCat[c.categoria] || 0) + m; });
  return `<div class="grid g-3-1">${tablaCostes(cs, false)}${panel('Equivalente mensual', Object.keys(porCat).length ? `<ul class="barras">${Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<li><span>${esc(CAT[k] || k)}</span><b>${eur.format(v)}</b></li>`).join('')}</ul>` : vacio('Sin costes indirectos.'), 'Anuales ÷ 12')}</div>`;
}
function costesPersonal() {
  const d = D(), ops = d.operarios || [], c = d.config || {};
  const editable = perm('personal');
  return `<div class="grid g-3-1">${panel('Personal de obra · coste por jornada', `<div class="tbl-wrap"><table><thead><tr><th>Operario</th><th>Categoría</th><th class="n">Nómina mensual (coste empresa)</th><th class="n">Coste jornada</th><th></th></tr></thead><tbody>${ops.map((o) => `<tr class="${o.activo === false ? 'eq-off' : ''}"><td><b>${e2(o.nombre)}</b></td><td>${esc(CATOP[o.categoria] || o.categoria)}</td>
      <td class="n">${editable ? `<input class="in-n" data-op-coste="${o.id}" inputmode="decimal" value="${o.coste_mensual == null ? '' : e2(o.coste_mensual)}" placeholder="tarifa" aria-label="Nómina de ${e2(o.nombre)}">` : '—'}</td><td class="n">${o.coste_jornada != null ? eur2.format(num(o.coste_jornada)) : '—'}</td>
      <td>${editable ? `<button class="btn" type="button" data-op-save="${o.id}">Guardar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin personal de obra.</td></tr>'}</tbody></table></div>
      ${editable ? `<form id="operario-form" class="row" style="gap:8px;padding:14px 16px;flex-wrap:wrap"><input name="nombre" required placeholder="Nombre y apellido" aria-label="Nombre"><select name="categoria" aria-label="Categoría">${opts([['oficial', 'Oficial'], ['peon', 'Peón'], ['encargado', 'Encargado']], 'oficial')}</select><input name="coste_mensual" inputmode="decimal" placeholder="Nómina coste empresa (€/mes)" aria-label="Nómina"><button class="btn primary" type="submit">Añadir operario</button></form>` : ''}`, 'Nómina ÷ ' + e2(c.dias_nomina || 21) + ' días', true)}
    ${panel('Tarifas y objetivos', R.esDireccion() ? `<form id="tarifas-form" class="form-grid">
      <label for="tf-of">Jornada oficial sin nómina (€)</label><input id="tf-of" name="coste_jornada_oficial" value="${e2(c.coste_jornada_oficial || '')}" inputmode="decimal">
      <label for="tf-pe">Jornada peón sin nómina (€)</label><input id="tf-pe" name="coste_jornada_peon" value="${e2(c.coste_jornada_peon || '')}" inputmode="decimal">
      <label for="tf-di">Días laborables por mes</label><input id="tf-di" name="dias_nomina" value="${e2(c.dias_nomina || '21')}" inputmode="numeric">
      <label for="tf-ve">Facturación anual de referencia (€)</label><input id="tf-ve" name="ventas_anuales_ref" value="${e2(c.ventas_anuales_ref || '')}" inputmode="decimal" placeholder="Si está vacío, se usa lo certificado en 12 meses">
      <label for="tf-ob">Beneficio real objetivo (%)</label><input id="tf-ob" name="objetivo_beneficio" value="${e2(c.objetivo_beneficio || '20')}" inputmode="decimal">
      <label for="tf-um">Aviso de indirecto (%)</label><input id="tf-um" name="umbral_ci" value="${e2(c.umbral_ci || '15')}" inputmode="decimal">
      <label for="tf-co">Correo de facturas de material</label><input id="tf-co" name="correo_materiales" value="${e2(c.correo_materiales || '')}" inputmode="email" placeholder="materiales@…">
      <span></span><div><button class="btn primary" type="submit">Guardar</button></div></form>` : `<dl class="fields"><dt>Objetivo</dt><dd>${e2(c.objetivo_beneficio || 20)} %</dd><dt>Aviso indirecto</dt><dd>${e2(c.umbral_ci || 15)} %</dd></dl><p class="muted small">Solo Dirección cambia tarifas y objetivos.</p>`)}</div>`;
}
function costesIngesta() {
  const ex = ui.excel, ia = ui.ia;
  return `<div class="grid g-2">
    ${panel('1 · Formulario', `<form id="coste-form" class="form-grid">
      <label for="cf2-tipo">Tipo</label><select id="cf2-tipo" name="tipo">${opts(perm('costes') ? [['directo', 'Directo (obra)'], ['indirecto', 'Indirecto (estructura)']] : [['directo', 'Directo (obra)']], 'directo')}</select>
      <label for="cf2-cat">Categoría</label><select id="cf2-cat" name="categoria">${opts([...CAT_DIR, ...CAT_IND.filter((x) => !CAT_DIR.includes(x))].map((c) => [c, CAT[c]]), 'material')}</select>
      <label for="cf2-obra">Obra</label><select id="cf2-obra" name="obra_id">${obraOpts(ui.iaObra || '', 'Sin obra (general)')}</select>
      <label for="cf2-con">Concepto</label><input id="cf2-con" name="concepto" required>
      <label for="cf2-pro">Proveedor</label><input id="cf2-pro" name="proveedor">
      <label for="cf2-imp">Importe sin IVA (€)</label><input id="cf2-imp" name="importe" inputmode="decimal" required>
      <label for="cf2-fec">Fecha</label><input id="cf2-fec" type="date" name="fecha" value="${hoyISO()}">
      <label for="cf2-per">Periodicidad</label><select id="cf2-per" name="periodicidad">${opts([['puntual', 'Puntual'], ['mensual', 'Mensual (constante)'], ['anual', 'Anual (se prorratea)']], 'puntual')}</select>
      <span></span><div><button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>Guardar coste</button></div></form>`)}
    ${panel('2 · Leer factura con IA (PDF o foto)', `<form id="ia-form" class="form-grid">
      <label for="ia-file">Archivo</label><input id="ia-file" name="archivo" type="file" accept="application/pdf,image/*" capture="environment" required>
      <label for="ia-obra">Obra</label><select id="ia-obra" name="obra_id">${obraOpts(ui.iaObra || '', 'Detectar por código de obra')}</select>
      <span></span><div><button class="btn primary" type="submit" ${ui.iaBusy ? 'disabled' : ''}>${ui.iaBusy ? 'Leyendo…' : 'Leer con IA'}</button></div></form>
      <p class="muted small" style="margin:10px 0 0">La IA saca proveedor, fecha, conceptos e importes sin IVA y el código de obra si aparece. Revisas y guardas. ${(D().config || {}).correo_materiales ? 'Correo de materiales: <b>' + e2(D().config.correo_materiales) + '</b>.' : ''}</p>
      ${ia ? previaIA(ia) : ''}`)}
  </div>
  ${panel('3 · Pegar desde Excel', `<p class="muted small" style="margin:0 0 10px">Copia las filas en Excel y pégalas aquí. Columnas: <b>Fecha · Concepto · Proveedor · Importe</b> y, opcionales, <b>Tipo · Categoría · Obra (código) · Periodicidad</b>. Si la primera fila tiene títulos, se usan.</p>
    <form id="excel-form"><textarea id="excel-txt" name="texto" rows="6" placeholder="01/11/2026&#9;Seguro de responsabilidad civil&#9;Aseguradora&#9;1.200&#9;indirecto&#9;seguro&#9;&#9;anual">${ex ? e2(ex.texto) : ''}</textarea>
    <div class="row" style="gap:10px;margin-top:10px"><select name="tipo" aria-label="Tipo por defecto">${opts(perm('costes') ? [['indirecto', 'Por defecto: indirecto'], ['directo', 'Por defecto: directo']] : [['directo', 'Por defecto: directo']], ex ? ex.tipo : (perm('costes') ? 'indirecto' : 'directo'))}</select><button class="btn" type="submit">Previsualizar</button>
    ${ex && ex.filas.length ? `<button class="btn primary" type="button" data-excel-guardar ${ex.filas.some((f) => f.error) || live.busy ? 'disabled' : ''}>Guardar ${ex.filas.length} costes</button>` : ''}</div></form>
    ${ex ? previaExcel(ex) : ''}`, 'Origen: excel')}`;
}
function previaIA(ia) {
  if (ia.error) return `<div class="callout" style="margin-top:12px">${pill('Error', 'crit')} ${e2(ia.error)}</div>`;
  return `<div class="ia-previa"><dl class="fields"><dt>Proveedor</dt><dd>${e2(ia.proveedor || '—')}</dd><dt>Documento</dt><dd>${e2(ia.tipo_documento || '')} ${e2(ia.numero || '')} · ${fmtD(ia.fecha)}</dd><dt>Obra</dt><dd>${ia.obra ? '<b>' + e2(ia.obra.codigo) + '</b> · ' + e2(ia.obra.titulo) : '<span class="muted">sin código de obra' + (ia.codigo_obra ? ' (leído: ' + e2(ia.codigo_obra) + ')' : '') + '</span>'}</dd><dt>Base · IVA · total</dt><dd>${eur2.format(num(ia.base_imponible))} · ${eur2.format(num(ia.iva))} · ${eur2.format(num(ia.total))}</dd></dl>
    <div class="row" style="gap:10px;margin-top:10px"><select data-ia-cat aria-label="Categoría">${opts(Object.entries(CAT), ia.categoria || 'material')}</select><select data-ia-tipo aria-label="Tipo">${opts([['directo', 'Directo'], ['indirecto', 'Indirecto']], ia.tipo_coste || 'directo')}</select>
    <button class="btn primary" type="button" data-ia-guardar ${live.busy ? 'disabled' : ''}>Guardar ${eur2.format(num(ia.base_imponible || ia.total))}${ia.obra ? ' en la obra ' + e2(ia.obra.codigo) : ''}</button><button class="btn" type="button" data-ia-descartar>Descartar</button></div>
    ${ia.demo ? '<p class="muted small">Lectura simulada en la demostración.</p>' : ''}</div>`;
}
function previaExcel(ex) {
  return `<div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Proveedor</th><th class="n">Importe</th><th>Tipo</th><th>Categoría</th><th>Obra</th><th>Periodicidad</th><th></th></tr></thead><tbody>${ex.filas.map((f) => `<tr class="${f.error ? 'err' : ''}"><td class="small">${esc(f.fecha || '')}</td><td>${e2(f.concepto)}</td><td class="small">${e2(f.proveedor || '')}</td><td class="n">${Number.isFinite(f.importe) ? eur2.format(f.importe) : '—'}</td><td>${esc(f.tipo)}</td><td>${esc(CAT[f.categoria] || f.categoria)}</td><td>${f.obra ? e2(f.obra.codigo) : '—'}</td><td>${esc(f.periodicidad)}</td><td>${f.error ? pill(f.error, 'crit') : pill('OK', 'ok')}</td></tr>`).join('')}</tbody></table></div>`;
}
function parseExcel(texto, tipoDef) {
  const filas = String(texto || '').split(/\r?\n/).map((l) => l.split(l.includes('\t') ? '\t' : ';').map((x) => x.trim())).filter((r) => r.some(Boolean));
  if (!filas.length) return [];
  let mapa = ['fecha', 'concepto', 'proveedor', 'importe', 'tipo', 'categoria', 'obra', 'periodicidad'];
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (filas[0].some((c) => /concepto|importe|proveedor|fecha/.test(norm(c)))) {
    mapa = filas.shift().map((c) => { const n = norm(c); return /fecha/.test(n) ? 'fecha' : /concepto|descrip/.test(n) ? 'concepto' : /proveedor|empresa/.test(n) ? 'proveedor' : /importe|total|base|euros|€/.test(n) ? 'importe' : /tipo/.test(n) ? 'tipo' : /categ/.test(n) ? 'categoria' : /obra|codigo/.test(n) ? 'obra' : /period/.test(n) ? 'periodicidad' : ''; });
  }
  const catDe = (s) => { const n = norm(s || ''); return Object.keys(CAT).find((k) => k === n || norm(CAT[k]) === n || norm(CAT[k]).startsWith(n) && n.length > 3) || (/gasol|combust/.test(n) ? 'gasolina' : /nomina/.test(n) ? 'nomina_estructura' : /segur/.test(n) ? 'seguro' : /prevenc/.test(n) ? 'prevencion' : ''); };
  return filas.slice(0, 300).map((r) => {
    const v = {}; mapa.forEach((k, i) => { if (k && r[i] != null) v[k] = r[i]; });
    let fecha = v.fecha || ''; const m = fecha.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/); if (m) fecha = (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
    const tipo = /indir/.test(norm(v.tipo || '')) ? 'indirecto' : /dir/.test(norm(v.tipo || '')) ? 'directo' : tipoDef;
    const obra = v.obra ? (D().obras || []).find((o) => norm(o.codigo) === norm(v.obra)) : null;
    const periodicidad = /anual/.test(norm(v.periodicidad || '')) ? 'anual' : /mensual/.test(norm(v.periodicidad || '')) ? 'mensual' : 'puntual';
    const f = { fecha: /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : '', concepto: (v.concepto || '').slice(0, 300), proveedor: (v.proveedor || '').slice(0, 120), importe: numES(v.importe), tipo, categoria: catDe(v.categoria) || (tipo === 'directo' ? 'material' : 'otros'), obra, periodicidad };
    f.error = !f.concepto ? 'falta concepto' : !Number.isFinite(f.importe) ? 'importe no válido' : v.obra && !obra ? 'obra ' + v.obra + ' no existe' : fecha && !f.fecha ? 'fecha no válida' : tipo === 'directo' && !obra && !perm('costes') ? 'falta obra' : '';
    return f;
  });
}

/* ---------- 08 Almacén ---------- */
views.almacen = () => {
  if (!perm('almacen')) return panel('Almacén', vacio('Tu rol no tiene acceso al almacén.'));
  const d = D(), as = d.articulos || [], ms = d.movimientos || [];
  const bajos = as.filter((a) => num(a.stock) < num(a.minimo)), valor = as.reduce((t, a) => t + Math.max(0, num(a.stock)) * num(a.coste_unitario), 0);
  return `${liveBanner()}<div class="kpis">
    <div class="kpi"><span class="l">Artículos</span><span class="v">${as.length}</span><span class="d">Material de almacén</span></div>
    <div class="kpi"><span class="l">Bajo mínimo</span><span class="v">${bajos.length}</span><span class="d">${bajos.length ? bajos.slice(0, 2).map((a) => e2(a.nombre)).join(', ') : 'Todo en orden'}</span></div>
    <div class="kpi"><span class="l">Valor en almacén</span><span class="v">${eur.format(valor)}</span><span class="d">Stock × último coste</span></div>
    <div class="kpi"><span class="l">Salidas a obra (30 días)</span><span class="v">${ms.filter((m) => m.tipo === 'salida' && String(m.fecha) >= addDias(hoyISO(), -30)).length}</span><span class="d">Se apuntan como coste de material</span></div></div>
  <div class="grid g-2">
    ${panel('Entrada o salida de material', `<form id="mov-form" class="form-grid">
      <label for="mv-tipo">Movimiento</label><select id="mv-tipo" name="tipo">${opts([['salida', 'Salida a obra'], ['entrada', 'Entrada al almacén']], 'salida')}</select>
      <label for="mv-art">Artículo</label><select id="mv-art" name="articulo_id" required>${opts([['', 'Elige…'], ...as.map((a) => [a.id, a.nombre + ' (' + n1(a.stock) + ' ' + a.unidad + ')'])], '')}</select>
      <label for="mv-can">Cantidad</label><input id="mv-can" name="cantidad" inputmode="decimal" required placeholder="3">
      <label for="mv-obra">Obra (salidas)</label><select id="mv-obra" name="obra_id">${obraOpts('', 'Elige la obra…')}</select>
      <label for="mv-cu">Coste unitario (entradas)</label><input id="mv-cu" name="coste_unitario" inputmode="decimal" placeholder="último coste">
      <label for="mv-not">Nota</label><input id="mv-not" name="nota" placeholder="Me llevo 3 sacos para la obra 36">
      <span></span><div><button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>Registrar</button></div></form>`)}
    ${panel('Nuevo artículo', `<form id="art-form" class="form-grid">
      <label for="ar-nom">Nombre</label><input id="ar-nom" name="nombre" required placeholder="Saco de mortero de reparación">
      <label for="ar-uni">Unidad</label><input id="ar-uni" name="unidad" value="ud">
      <label for="ar-cu">Coste unitario (€)</label><input id="ar-cu" name="coste_unitario" inputmode="decimal">
      <label for="ar-min">Stock mínimo</label><input id="ar-min" name="minimo" inputmode="decimal">
      <span></span><div><button class="btn" type="submit">Crear artículo</button></div></form>
      <p class="muted small" style="margin:10px 0 0">Por WhatsApp: «ATLAS, me llevo 3 sacos para la obra 36» (cuando el WhatsApp de R4 esté vinculado).</p>`)}
  </div>
  ${panel('Stock', `<div class="tbl-wrap"><table><thead><tr><th>Artículo</th><th class="n">Stock</th><th class="n">Mínimo</th><th class="n">Coste unitario</th><th>Estado</th></tr></thead><tbody>${as.map((a) => `<tr><td><b>${e2(a.nombre)}</b></td><td class="n">${n1(a.stock)} ${e2(a.unidad)}</td><td class="n">${n1(a.minimo)}</td><td class="n">${eur2.format(num(a.coste_unitario))}</td><td>${num(a.stock) < 0 ? pill('Negativo: falta una entrada', 'crit') : num(a.stock) < num(a.minimo) ? pill('Reponer', 'warn') : pill('OK', 'ok')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin artículos.</td></tr>'}</tbody></table></div>`, srcTag(isLive()), true)}
  ${panel('Movimientos recientes', `<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Movimiento</th><th>Artículo</th><th class="n">Cantidad</th><th>Obra</th><th>Origen</th><th>Nota</th></tr></thead><tbody>${ms.map((m) => { const o = obraDe(m.obra_id); return `<tr><td class="small">${fmtDc(m.fecha)}</td><td>${m.tipo === 'entrada' ? pill('Entrada', 'ok') : pill('Salida', 'info')}</td><td>${e2(m.articulo)}</td><td class="n">${n1(m.cantidad)} ${e2(m.unidad || '')}</td><td>${o ? '<b>' + e2(o.codigo) + '</b>' : '—'}</td><td>${pill(m.origen)}</td><td class="small">${e2(m.nota || '')}</td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Sin movimientos.</td></tr>'}</tbody></table></div>`, '', true)}`;
};

/* ---------- 04 Presupuestos ---------- */
function abrirPres(id) {
  if (id === 'nuevo') {
    const sig = Math.max(0, ...[...(D().presupuestos || []), ...(D().obras || [])].map((x) => parseInt(x.codigo, 10) || 0)) + 1;
    ui.draft = { codigo: String(sig), titulo: '', cliente_id: '', ubicacion: '', ajuste_pct: 0, notas: '', lineas: [], estado: 'borrador' };
  } else {
    const p = (D().presupuestos || []).find((x) => String(x.id) === String(id)); if (!p) return;
    ui.draft = JSON.parse(JSON.stringify({ id: p.id, codigo: p.codigo, titulo: p.titulo, cliente_id: p.cliente_id || '', ubicacion: p.ubicacion || '', ajuste_pct: num(p.ajuste_pct), notas: p.notas || '', estado: p.estado, obra_id: p.obra_id, origen: p.origen, lineas: (p.lineas || []).map((l) => ({ ...l, cantidad_txt: l.cantidad_txt || n1(l.cantidad) })) }));
  }
  ui.presId = id;
}
views.presupuestos = () => {
  if (!perm('ver_presupuestos')) return panel('Presupuestos', vacio('Tu rol no tiene acceso a presupuestos.'));
  const d = D(), ps = d.presupuestos || [];
  if (ui.presId && ui.presId !== 'nuevo' && !ps.find((p) => String(p.id) === String(ui.presId))) ui.presId = null;
  if (!ui.presId && ps[0]) abrirPres(ps[0].id);
  if (!ui.presId && perm('presupuestos')) abrirPres('nuevo');
  return `${liveBanner()}<div class="crm-shell obras-shell">
    <section class="panel crm-list"><header><h2>Presupuestos</h2><div class="meta">${perm('presupuestos') ? '<button class="btn primary" type="button" data-go-pres="nuevo">+ Nuevo</button>' : ''}</div></header><div class="body flush"><div role="listbox" aria-label="Presupuestos">
      ${ps.map((p) => { const e = EST_PRES[p.estado] || [p.estado, '']; return `<button class="crm-row obra-row" type="button" aria-selected="${String(p.id) === String(ui.presId)}" data-go-pres="${p.id}"><span class="codigo">${e2(p.codigo)}</span><span style="min-width:0"><span class="nm">${e2(p.titulo)}</span><span class="sb">${e2(p.cliente_nombre || '—')}${p.origen === 'atlas' ? ' · por ATLAS' : ''}</span></span><span class="obra-st">${pill(e[0], e[1])}<span class="small muted">${eur.format(num((p.totales || {}).total))}</span></span></button>`; }).join('') || '<p class="muted" style="padding:16px">Sin presupuestos.</p>'}
    </div></div></section>
    <div>${ui.draft ? editorPres() : ''}</div></div>
  ${catalogo()}`;
};
function editorPres() {
  const x = ui.draft, t = totalesPres(x), ed = perm('presupuestos') && ['borrador', 'enviado'].includes(x.estado || 'borrador');
  const partidas = (D().partidas || []).filter((p) => p.activo !== false);
  const dis = ed ? '' : 'disabled';
  return panel(x.id ? `Presupuesto ${e2(x.codigo)}` : 'Nuevo presupuesto', `<form id="pres-form" class="pres-form">
    <div class="form-grid">
      <label for="pr-cod">Código</label><input id="pr-cod" data-d="codigo" value="${e2(x.codigo)}" ${x.id ? 'disabled' : ''} required>
      <label for="pr-tit">Trabajo</label><input id="pr-tit" data-d="titulo" value="${e2(x.titulo)}" ${dis} required placeholder="Mecanovigas en garaje">
      <label for="pr-cli">Cliente</label><select id="pr-cli" data-d="cliente_id" ${dis}>${clienteOpts(x.cliente_id)}</select>
      <label for="pr-ubi">Ubicación</label><input id="pr-ubi" data-d="ubicacion" value="${e2(x.ubicacion)}" ${dis}>
    </div>
    <div class="tbl-wrap" style="margin-top:14px"><table class="pres-tbl"><thead><tr><th>Partida</th><th>Cantidad</th><th>Ud</th><th class="n">Precio</th><th class="n">Importe</th><th></th></tr></thead><tbody>
      ${x.lineas.map((l, i) => `<tr><td><input data-l="${i}" data-k="descripcion" value="${e2(l.descripcion)}" ${dis} aria-label="Descripción"></td><td><input class="in-n" data-l="${i}" data-k="cantidad_txt" value="${e2(l.cantidad_txt ?? n1(l.cantidad))}" ${dis} aria-label="Cantidad" title="Admite 3x3,20"></td><td>${e2(l.unidad)}</td><td class="n"><input class="in-n" data-l="${i}" data-k="precio" value="${num(l.precio) ? e2(l.precio) : ''}" placeholder="pendiente" ${dis} aria-label="Precio"></td><td class="n" data-imp="${i}">${eur2.format(num(l.cantidad) * num(l.precio))}</td><td>${ed ? `<button class="btn" type="button" data-l-del="${i}" aria-label="Quitar">×</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Añade partidas del catálogo.</td></tr>'}
    </tbody></table></div>
    ${ed ? `<div class="row" style="gap:8px;margin-top:10px"><select id="pr-add" aria-label="Partida estándar">${opts(partidas.map((p) => [p.id, p.codigo + ' · ' + p.descripcion + (p.precio == null ? ' (sin precio)' : '')]), '')}</select><button class="btn" type="button" data-l-add>Añadir partida</button></div>` : ''}
    <div class="pres-tot" id="pres-tot">${totPresHTML(t, x)}</div>
    <div class="form-grid" style="margin-top:12px"><label for="pr-aj">Ajuste por dificultad (%)</label><input id="pr-aj" data-d="ajuste_pct" value="${e2(x.ajuste_pct)}" inputmode="decimal" ${dis} placeholder="20 = acceso complicado">
      <label for="pr-not">Notas</label><input id="pr-not" data-d="notas" value="${e2(x.notas)}" ${dis}></div>
    <div class="row" style="gap:10px;margin-top:14px;flex-wrap:wrap">
      ${ed ? `<button class="btn primary" type="submit" ${live.busy ? 'disabled' : ''}>Guardar</button>` : ''}
      ${x.id && x.estado === 'borrador' && perm('presupuestos') ? `<button class="btn" type="button" data-pres-estado="enviado">Marcar enviado al cliente</button>` : ''}
      ${x.id && ['borrador', 'enviado'].includes(x.estado) && perm('aprobar') ? `<label class="small muted">Inicio <input type="date" id="pr-ini" value="${addDias(hoyISO(), 7)}"></label><button class="btn primary" type="button" data-pres-estado="aceptado">Aceptar y abrir obra</button>` : ''}
      ${x.id && ['borrador', 'enviado'].includes(x.estado) && perm('presupuestos') ? `<button class="btn" type="button" data-pres-estado="rechazado">Rechazado</button>` : ''}
      ${x.obra_id ? `<button class="btn" type="button" data-go-obra="${x.obra_id}">Ver obra ${e2(x.codigo)}</button>` : ''}
    </div></form>`, `${x.estado ? pill((EST_PRES[x.estado] || [x.estado])[0], (EST_PRES[x.estado] || [0, ''])[1]) : ''}${x.origen === 'atlas' ? '<span class="agent">ATLAS</span>' : ''}`);
}
function totPresHTML(t, x) {
  const dias = Math.ceil(t.jornadas / 3);
  return `<span>Subtotal <b>${eur2.format(t.subtotal)}</b></span><span>Ajuste <b>${num(x.ajuste_pct) >= 0 ? '+' : ''}${n1(x.ajuste_pct)} %</b></span><span class="big">Total <b>${eur2.format(t.total)}</b></span><span>Material <b>${eur.format(t.material)}</b> · Mano de obra <b>${eur.format(t.total - t.material)}</b></span><span>${n1(t.jornadas)} jornadas ≈ ${dias} día${dias === 1 ? '' : 's'} con 2 oficiales + 1 peón</span>${t.sin_precio ? `<span>${pill(t.sin_precio + ' sin precio', 'warn')}</span>` : ''}`;
}
function catalogo() {
  const ps = D().partidas || [], ed = perm('precios');
  const pend = ps.filter((p) => p.precio == null).length;
  return panel('Catálogo de partidas estándar', `<div class="tbl-wrap"><table><thead><tr><th>Código</th><th>Partida</th><th>Ud</th><th class="n">Precio</th><th class="n">% material</th><th class="n">Jornadas/ud</th><th></th></tr></thead><tbody>${ps.map((p) => `<tr><td class="mono small">${e2(p.codigo)}</td><td>${e2(p.descripcion)}<div class="muted small">${e2(p.familia || '')}</div></td><td>${e2(p.unidad)}</td>
    <td class="n">${ed ? `<input class="in-n" data-pt="${p.id}" data-k="precio" value="${p.precio == null ? '' : e2(p.precio)}" placeholder="pendiente" aria-label="Precio de ${e2(p.codigo)}">` : p.precio == null ? pill('Pendiente', 'warn') : eur2.format(num(p.precio))}</td>
    <td class="n">${ed ? `<input class="in-n" data-pt="${p.id}" data-k="material_pct" value="${e2(p.material_pct)}" aria-label="% material">` : n1(p.material_pct)}</td>
    <td class="n">${ed ? `<input class="in-n" data-pt="${p.id}" data-k="jornadas_ud" value="${e2(p.jornadas_ud)}" aria-label="Jornadas por unidad">` : n1(p.jornadas_ud)}</td>
    <td>${ed ? `<button class="btn" type="button" data-pt-save="${p.id}">Guardar</button>` : ''}${p.ejemplo ? ' ' + pill('ejemplo') : ''}</td></tr>`).join('')}</tbody></table></div>
    <p class="muted small" style="margin:10px 16px 14px">${pend ? `<b>${pend} partidas sin precio</b>: R4 enviará la fórmula y los precios (mecanoviga, viga castellana, apuntalamiento…). ` : ''}ATLAS usará este catálogo para preparar presupuestos por WhatsApp: «Hola ATLAS, 3 mecanovigas de 3,20 m, 8 ml de viga castellana y 60 m² de apuntalamiento».</p>`, pend ? pill(pend + ' pendientes', 'warn') : srcTag(isLive()), true);
}

/* ---------- 09 Facturación: certificaciones (encima del modo VERI*FACTU) ---------- */
const facturacionBase = views.facturacion;
views.facturacion = () => {
  const certs = []; (D().obras || []).forEach((o) => (o.certificaciones || []).forEach((c) => certs.push({ ...c, obra: o })));
  const grupo = (est) => certs.filter((c) => c.estado === est);
  const fila = (c) => `<tr><td><b>${e2(c.obra.codigo)}</b> · ${e2(c.obra.titulo)}<div class="muted small">${e2(c.obra.cliente_nombre || '')}</div></td><td>${c.tipo === 'final' ? 'Final' : 'Parcial'} nº ${c.numero}</td><td class="small">${fmtD(c.fecha)}${c.conforme_por ? '<div class="muted">' + e2(c.conforme_por) + '</div>' : ''}</td><td class="n">${eur.format(num(c.importe))}</td><td>${pill((EST_CERT[c.estado] || [c.estado])[0], (EST_CERT[c.estado] || [0, ''])[1])}</td><td>${c.estado === 'conforme' && perm('facturar') ? `<button class="btn primary" type="button" data-cert="${c.id}" data-cert-estado="facturada">Marcar facturada</button>` : c.estado === 'enviada' && perm('facturar') ? `<button class="btn" type="button" data-cert="${c.id}" data-cert-estado="conforme">Conforme (Dirección)</button>` : ''}</td></tr>`;
  const lista = [...grupo('conforme'), ...grupo('enviada'), ...grupo('borrador')];
  return `${panel('Certificaciones de obra · listas para facturar', lista.length ? `<div class="tbl-wrap"><table><thead><tr><th>Obra</th><th>Certificación</th><th>Fecha</th><th class="n">Importe</th><th>Estado</th><th></th></tr></thead><tbody>${lista.map(fila).join('')}</tbody></table></div>` : vacio('Sin certificaciones pendientes.'), `${srcTag(isLive())}${pill(grupo('conforme').length + ' por facturar', grupo('conforme').length ? 'ok' : '')}`, true)}${facturacionBase()}`;
};

/* ---------- 14 Equipo y clientes ---------- */
const equipoBase = views.equipo;
views.equipo = () => {
  if (!R.esDireccion()) return equipoBase();
  const tabs = [['accesos', 'Accesos'], ['personal', 'Personal de obra'], ['clientes', 'Clientes con portal']];
  const cuerpo = ui.eqTab === 'personal' ? costesPersonal() : ui.eqTab === 'clientes' ? clientesPortal() : equipoBase();
  return `<div class="seg-wrap">${segs('eq-tab', ui.eqTab, tabs)}</div>${cuerpo}`;
};
function clientesPortal() {
  const d = D(), us = (d.usuarios || []).filter((u) => u.rol === 'cliente' || u.solicitud === 'cliente');
  const cs = R.clientesDe(d), obras = d.obras || [];
  const conObra = cs.filter((c) => obras.some((o) => String(o.cliente_id) === String(c.id)));
  return `<div class="grid g-3-1">${panel('Clientes con acceso al portal', us.length ? `<div class="tbl-wrap"><table><thead><tr><th>Cuenta de Google</th><th>Ficha del CRM</th><th>Obras</th><th>Estado</th></tr></thead><tbody>${us.map((u) => { const c = cs.find((x) => String(x.id) === String(u.cliente_id || u.cliente_sugerido)); const n = c ? obras.filter((o) => String(o.cliente_id) === String(c.id)).length : 0; return `<tr><td><b>${e2(u.nombre || u.email)}</b><div class="muted small">${e2(u.email)}</div></td><td>${c ? e2(c.nombre || c.empresa) : '<span class="muted">sin vincular</span>'}</td><td>${n}</td><td>${u.estado === 'activo' ? pill('Activo', 'ok') : u.estado === 'pendiente' ? pill('Pendiente de aprobar', 'warn') : pill('Bloqueado', 'crit')}</td></tr>`; }).join('')}</tbody></table></div>` : vacio('Ningún cliente ha pedido acceso todavía.'), srcTag(isLive()), true)}
    ${panel('Cómo entra un cliente', `<ol class="eq-pasos"><li>Envíale el enlace de la plataforma${(d.config || {}).plataforma_url ? ' (<b>' + e2(d.config.plataforma_url) + '</b>)' : ''}.</li><li>Pulsa <b>03 · Clientes → Entrar con Google</b>.</li><li>En <b>Accesos</b> aparece su solicitud: elige rol <b>Cliente</b> y su ficha del CRM (se propone la que coincide por email) y aprueba.</li><li>Ve solo sus obras: avance, fechas, certificaciones; da su conformidad antes de facturar.</li></ol>
      ${conObra.length ? `<p class="muted small" style="margin:12px 0 0">Clientes con obra: ${conObra.map((c) => e2(c.nombre || c.empresa)).join(', ')}.</p>` : ''}`)}</div>`;
}

/* ---------- Portal del cliente ---------- */
views['portal-cliente'] = () => {
  let p = isLive() ? (D().portal || {}) : null;
  if (!p) { const c = R.clientesDe(DEMO).find((x) => x.id === 5) || {}; p = { cliente: c, obras: DEMO.obras.filter((o) => o.cliente_id === 5), presupuestos: DEMO.presupuestos.filter((x) => x.cliente_id === 5 && ['enviado', 'aceptado'].includes(x.estado)).map((x) => ({ ...x, total: totalesPres(x).total })) }; }
  const c = p.cliente || {}, obras = p.obras || [];
  return `<section class="panel portal-cli-hola"><div class="body"><img src="assets/r4-logo.svg" alt="R4 Rehabilitación de Estructuras" width="170" height="36"><h2>Hola${c.nombre ? ', ' + e2(String(c.nombre).split(' ')[0]) : ''}</h2><p class="muted" style="margin:0">${e2(c.empresa || '')}${c.empresa ? ' · ' : ''}Aquí sigues tu obra con R4: avance, fechas previstas y certificaciones.${isLive() ? '' : ' <b>Demostración.</b>'}</p></div></section>
  ${obras.length ? obras.map((o) => { const e = EST_OBRA[o.estado] || [o.estado, '']; return `<section class="panel"><header><h2>Obra ${e2(o.codigo)} · ${e2(o.titulo)}</h2><div class="meta">${pill(e[0], e[1])}</div></header><div class="body">
    <div class="kpis kpis-mini"><div class="kpi"><span class="l">Avance</span><span class="v">${pc(Math.min(100, num(o.avance)))}</span>${R.prog(Math.min(100, num(o.avance)))}</div><div class="kpi"><span class="l">Inicio</span><span class="v" style="font-size:20px">${fmtD(o.fecha_inicio)}</span></div><div class="kpi"><span class="l">Fin previsto</span><span class="v" style="font-size:20px">${fmtD(o.fecha_fin)}</span></div><div class="kpi"><span class="l">Presupuesto vigente</span><span class="v">${eur.format(num(o.importe))}</span></div></div>
    ${o.ubicacion ? `<p class="muted" style="margin:12px 0">${e2(o.ubicacion)}</p>` : ''}
    <h3 class="h3">Certificaciones</h3>${(o.certificaciones || []).filter((x) => x.estado !== 'borrador').length ? `<ul class="certs">${(o.certificaciones || []).filter((x) => x.estado !== 'borrador').map((x) => { const on = ui.confirmCert === x.id; return `<li><span class="codigo">${x.numero}</span><span><b>${x.tipo === 'final' ? 'Certificación final' : 'Certificación parcial'} · ${eur.format(num(x.importe))}</b><span class="muted small" style="display:block">${fmtD(x.fecha)}${x.notas ? ' · ' + e2(x.notas) : ''}</span></span><span class="cert-acc">${x.estado === 'enviada' ? `<button class="btn ${on ? 'danger' : 'primary'}" type="button" data-cli-conforme="${x.id}">${on ? '¿Confirmas? Toca otra vez' : 'Doy mi conformidad'}</button>` : pill(x.estado === 'conforme' ? 'Conforme · pendiente de factura' : 'Facturada', x.estado === 'conforme' ? 'ok' : 'acc')}</span></li>`; }).join('')}</ul>` : vacio('Todavía no hay certificaciones.')}
  </div></section>`; }).join('') : panel('Tu obra', vacio('Aún no hay obras abiertas a tu nombre. Cuando R4 acepte tu presupuesto, la verás aquí.'))}
  ${(p.presupuestos || []).length ? panel('Tus presupuestos', `<div class="tbl-wrap"><table><thead><tr><th>Código</th><th>Trabajo</th><th>Estado</th><th class="n">Total</th></tr></thead><tbody>${p.presupuestos.map((x) => `<tr><td><b>${e2(x.codigo)}</b></td><td>${e2(x.titulo)}</td><td>${pill((EST_PRES[x.estado] || [x.estado])[0], (EST_PRES[x.estado] || [0, ''])[1])}</td><td class="n">${eur.format(num(x.total))}</td></tr>`).join('')}</tbody></table></div>`, '', true) : ''}
  <p class="portal-note">¿Dudas? Escribe a R4 por WhatsApp: te atiende ATLAS, nuestro asistente. R4 Rehabilitación de Estructuras · Arenal (Mallorca)</p>`;
};

/* ---------- eventos ---------- */
const ir = (hash) => { if (location.hash === hash) render(); else location.hash = hash; };
view.addEventListener('click', (e) => {
  const t = e.target.closest('[data-obra],[data-obra-tab],[data-obras-filtro],[data-obra-nueva],[data-obra-cancelar],[data-go],[data-go-obra],[data-go-pres],[data-costes-tab],[data-eq-tab],[data-cert],[data-coste-del],[data-op-save],[data-pt-save],[data-l-add],[data-l-del],[data-pres-estado],[data-excel-guardar],[data-ia-guardar],[data-ia-descartar],[data-cli-conforme],[data-eq-tab-go]');
  if (!t) return;
  const ds = t.dataset;
  if (ds.costesTabGo) ui.costesTab = ds.costesTabGo;
  if (ds.iaObra) ui.iaObra = ds.iaObra;
  if (ds.eqTabGo) { ui.eqTab = ds.eqTabGo; }
  if (ds.obra !== undefined && t.classList.contains('obra-row')) { ui.obraId = Number(ds.obra); ui.nuevaObra = false; render(); return; }
  if (ds.goObra !== undefined) { e.preventDefault(); ui.obraId = Number(ds.goObra); ui.nuevaObra = false; if (ds.obraTabGo) ui.obraTab = ds.obraTabGo; if (ui.obraTab === 'parte') ui.parteFecha = hoyISO(); ir('#obras'); return; }
  if (ds.goPres !== undefined) { abrirPres(ds.goPres === 'nuevo' ? 'nuevo' : Number(ds.goPres)); ir('#presupuestos'); return; }
  if (ds.go) { e.preventDefault(); ir(ds.go); return; }
  if (ds.obraTab) { ui.obraTab = ds.obraTab; render(); return; }
  if (ds.obrasFiltro) { ui.soloCurso = ds.obrasFiltro === 'curso'; render(); return; }
  if (ds.obraNueva !== undefined) { ui.nuevaObra = true; render(); const f = document.getElementById('ob-cod'); if (f) f.focus(); return; }
  if (ds.obraCancelar !== undefined) { ui.nuevaObra = false; render(); return; }
  if (ds.costesTab) { ui.costesTab = ds.costesTab; render(); return; }
  if (ds.eqTab) { ui.eqTab = ds.eqTab; render(); return; }
  if (ds.eqTabGo) { ir('#equipo'); return; }
  if (ds.cert) { const est = ds.certEstado; return act({ op: 'cert_estado', id: Number(ds.cert), estado: est }, { enviada: 'Certificación enviada al cliente: puede dar su conformidad en su portal.', conforme: 'Certificación conforme: lista para facturar.', facturada: 'Certificación marcada como facturada.', borrador: 'Certificación vuelta a borrador.' }[est] || 'Hecho.'); }
  if (ds.costeDel) { const id = Number(ds.costeDel); if (ui.borrar !== id) { ui.borrar = id; render(); setTimeout(() => { if (ui.borrar === id) { ui.borrar = null; render(); } }, 5000); return; } ui.borrar = null; return act({ op: 'coste_del', id }, 'Coste borrado.'); }
  if (ds.opSave) { const id = Number(ds.opSave); const inp = view.querySelector(`[data-op-coste="${id}"]`); return act({ op: 'operario_set', id, coste_mensual: inp ? inp.value.trim() : '' }, 'Nómina guardada: coste por jornada actualizado.'); }
  if (ds.ptSave) { const id = Number(ds.ptSave); const v = (k) => (view.querySelector(`[data-pt="${id}"][data-k="${k}"]`) || {}).value; return act({ op: 'partida_set', id, precio: String(v('precio') || '').trim(), material_pct: v('material_pct'), jornadas_ud: v('jornadas_ud') }, 'Partida guardada.'); }
  if (ds.lAdd !== undefined) { const sel = document.getElementById('pr-add'); const p = (D().partidas || []).find((x) => String(x.id) === sel.value); if (!p) return; ui.draft.lineas.push({ partida_id: p.id, descripcion: p.descripcion, unidad: p.unidad, cantidad: 1, cantidad_txt: '1', precio: p.precio == null ? 0 : num(p.precio), material_pct: num(p.material_pct), jornadas_ud: num(p.jornadas_ud) }); render(); return; }
  if (ds.lDel !== undefined) { ui.draft.lineas.splice(Number(ds.lDel), 1); render(); return; }
  if (ds.presEstado) {
    const x = ui.draft, est = ds.presEstado, ini = (document.getElementById('pr-ini') || {}).value;
    return Promise.resolve(act(Object.assign({ op: 'presupuesto_estado', id: x.id, estado: est }, est === 'aceptado' && ini ? { fecha_inicio: ini } : {}), est === 'aceptado' ? 'Presupuesto aceptado: la obra ' + x.codigo + ' ya está en Obras.' : 'Presupuesto ' + est + '.')).then(() => { abrirPres(x.id); render(); });
  }
  if (ds.excelGuardar !== undefined && ui.excel) {
    const costes = ui.excel.filas.map((f) => ({ tipo: f.tipo, categoria: f.categoria, obra_id: f.obra ? f.obra.id : undefined, concepto: f.concepto, proveedor: f.proveedor || undefined, importe: f.importe, fecha: f.fecha || undefined, periodicidad: f.periodicidad, origen: 'excel' }));
    return Promise.resolve(act({ op: 'coste_add', costes }, (r) => (r && r.insertados || costes.length) + ' costes importados desde Excel.')).then(() => { ui.excel = null; render(); });
  }
  if (ds.iaGuardar !== undefined && ui.ia) {
    const ia = ui.ia, cat = (view.querySelector('[data-ia-cat]') || {}).value || 'material', tipo = (view.querySelector('[data-ia-tipo]') || {}).value || 'directo';
    const concepto = (ia.tipo_documento === 'factura' ? 'Factura ' : '') + (ia.numero ? ia.numero + ' · ' : '') + ((ia.lineas || []).map((l) => l.concepto).filter(Boolean).slice(0, 3).join(', ') || ia.proveedor || 'Documento');
    return Promise.resolve(act({ op: 'coste_add', tipo, categoria: cat, obra_id: ia.obra ? ia.obra.id : undefined, concepto: concepto.slice(0, 300), proveedor: ia.proveedor || undefined, importe: num(ia.base_imponible || ia.total), fecha: /^\d{4}-\d{2}-\d{2}$/.test(ia.fecha || '') ? ia.fecha : undefined, origen: ia.origen || 'pdf', documento: ia.archivo || undefined }, 'Factura guardada como coste' + (ia.obra ? ' de la obra ' + ia.obra.codigo : '') + '.')).then(() => { ui.ia = null; render(); });
  }
  if (ds.iaDescartar !== undefined) { ui.ia = null; render(); return; }
  if (ds.cliConforme) { const id = Number(ds.cliConforme); if (ui.confirmCert !== id) { ui.confirmCert = id; render(); setTimeout(() => { if (ui.confirmCert === id) { ui.confirmCert = null; render(); } }, 5000); return; } ui.confirmCert = null; return act({ op: 'cert_conforme', id }, 'Gracias: tu conformidad queda registrada y R4 emitirá la factura.'); }
});
// Editor de presupuesto: escribe en el borrador sin repintar (no se pierde el foco) y actualiza totales
view.addEventListener('input', (e) => {
  const el = e.target, x = ui.draft; if (!x) return;
  if (el.dataset.d) { x[el.dataset.d] = el.value; if (el.dataset.d === 'ajuste_pct') { x.ajuste_pct = numES(el.value) || 0; } }
  else if (el.dataset.l !== undefined) {
    const l = x.lineas[Number(el.dataset.l)]; if (!l) return;
    if (el.dataset.k === 'cantidad_txt') { l.cantidad_txt = el.value; l.cantidad = cantidad(el.value) || 0; }
    else if (el.dataset.k === 'precio') l.precio = numES(el.value) || 0; else l[el.dataset.k] = el.value;
    const c = view.querySelector(`[data-imp="${el.dataset.l}"]`); if (c) c.textContent = eur2.format(num(l.cantidad) * num(l.precio));
  } else return;
  const tt = document.getElementById('pres-tot'); if (tt) tt.innerHTML = totPresHTML(totalesPres(x), x);
});
view.addEventListener('change', (e) => { if (e.target.dataset.parteFecha !== undefined) { ui.parteFecha = e.target.value || hoyISO(); render(); } });
const fv = (fd, k) => { const v = fd.get(k); return v == null ? undefined : String(v).trim(); };
const sinVacios = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
view.addEventListener('submit', async (e) => {
  const f = e.target, fd = new FormData(f);
  const ids = ['parte-form', 'version-form', 'coste-obra-form', 'cert-form', 'obra-form', 'coste-form', 'excel-form', 'ia-form', 'mov-form', 'art-form', 'operario-form', 'tarifas-form', 'pres-form'];
  if (!ids.includes(f.id)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const obra = Number(f.dataset.obra);
  if (f.id === 'parte-form') {
    const ops = fd.getAll('op').map((id) => ({ id: Number(id), jornadas: fd.get('j-' + id) || '1' }));
    return act({ op: 'parte_set', obra_id: obra, fecha: fd.get('fecha'), operarios: ops }, `Parte guardado: ${ops.length} operario${ops.length === 1 ? '' : 's'} el ${fmtD(fd.get('fecha'))}.`);
  }
  if (f.id === 'version-form') return act(sinVacios({ op: 'obra_version', obra_id: obra, linea: fv(fd, 'linea'), importe: fv(fd, 'importe'), jornadas: fv(fd, 'jornadas'), material: fv(fd, 'material'), motivo: fv(fd, 'motivo') }), 'Versión guardada: fecha de fin y planning recalculados.');
  if (f.id === 'coste-obra-form') return act(sinVacios({ op: 'coste_add', tipo: 'directo', obra_id: obra, categoria: fv(fd, 'categoria'), concepto: fv(fd, 'concepto'), proveedor: fv(fd, 'proveedor'), importe: fv(fd, 'importe'), fecha: fv(fd, 'fecha') }), 'Coste añadido a la obra.');
  if (f.id === 'cert-form') return act(sinVacios({ op: 'cert_set', obra_id: obra, tipo: fv(fd, 'tipo'), importe: fv(fd, 'importe'), fecha: fv(fd, 'fecha'), notas: fv(fd, 'notas') }), 'Certificación creada en borrador.');
  if (f.id === 'obra-form') {
    const id = f.dataset.id ? Number(f.dataset.id) : undefined;
    const p = { op: 'obra_set', id, codigo: fv(fd, 'codigo'), titulo: fv(fd, 'titulo'), cliente_id: fv(fd, 'cliente_id') || (id ? '' : undefined), ubicacion: fv(fd, 'ubicacion'), fecha_inicio: fv(fd, 'fecha_inicio') || undefined, oficiales: fv(fd, 'oficiales'), peones: fv(fd, 'peones'), estado: fv(fd, 'estado'), periodo_control: fv(fd, 'periodo_control'), presupuesto_url: fv(fd, 'presupuesto_url'), notas: fv(fd, 'notas'), importe: fv(fd, 'importe'), jornadas: fv(fd, 'jornadas'), material: fv(fd, 'material') };
    if (id && p.cliente_id === '') delete p.cliente_id;
    Object.keys(p).forEach((k) => p[k] === undefined && delete p[k]);
    ['importe', 'jornadas', 'material'].forEach((k) => { if (p[k] === '') delete p[k]; });
    await act(p, id ? 'Datos de la obra guardados.' : 'Obra ' + p.codigo + ' abierta.');
    if (!id) { ui.nuevaObra = false; const o = (D().obras || []).find((x) => String(x.codigo).toLowerCase() === String(p.codigo).toLowerCase()); if (o) ui.obraId = o.id; ui.obraTab = 'parte'; render(); }
    return;
  }
  if (f.id === 'coste-form') return act(sinVacios({ op: 'coste_add', tipo: fv(fd, 'tipo'), categoria: fv(fd, 'categoria'), obra_id: fv(fd, 'obra_id'), concepto: fv(fd, 'concepto'), proveedor: fv(fd, 'proveedor'), importe: fv(fd, 'importe'), fecha: fv(fd, 'fecha'), periodicidad: fv(fd, 'periodicidad') }), 'Coste guardado.');
  if (f.id === 'excel-form') { ui.excel = { texto: fd.get('texto'), tipo: fd.get('tipo'), filas: parseExcel(fd.get('texto'), fd.get('tipo')) }; render(); if (!ui.excel.filas.length) toast('No hay filas que leer.'); return; }
  if (f.id === 'ia-form') return leerIA(fd.get('archivo'), fd.get('obra_id'));
  if (f.id === 'mov-form') return act(sinVacios({ op: 'movimiento_add', tipo: fv(fd, 'tipo'), articulo_id: fv(fd, 'articulo_id'), cantidad: fv(fd, 'cantidad'), obra_id: fv(fd, 'tipo') === 'salida' ? fv(fd, 'obra_id') : undefined, coste_unitario: fv(fd, 'tipo') === 'entrada' ? fv(fd, 'coste_unitario') : undefined, nota: fv(fd, 'nota') }), (r) => 'Movimiento registrado' + (r && r.aviso ? ' · ' + r.aviso : '') + '.');
  if (f.id === 'art-form') return act(sinVacios({ op: 'articulo_set', nombre: fv(fd, 'nombre'), unidad: fv(fd, 'unidad'), coste_unitario: fv(fd, 'coste_unitario'), minimo: fv(fd, 'minimo') }), 'Artículo creado.');
  if (f.id === 'operario-form') return act(sinVacios({ op: 'operario_set', nombre: fv(fd, 'nombre'), categoria: fv(fd, 'categoria'), coste_mensual: fv(fd, 'coste_mensual') }), 'Operario añadido.');
  if (f.id === 'tarifas-form') { const config = {}; ['coste_jornada_oficial', 'coste_jornada_peon', 'dias_nomina', 'ventas_anuales_ref', 'objetivo_beneficio', 'umbral_ci', 'correo_materiales'].forEach((k) => { config[k] = fv(fd, k) || ''; }); return act({ op: 'set_config', config }, 'Tarifas y objetivos guardados.'); }
  if (f.id === 'pres-form') {
    const x = ui.draft;
    const p = { op: 'presupuesto_set', id: x.id, codigo: x.id ? undefined : x.codigo, titulo: x.titulo, cliente_id: x.cliente_id || undefined, ubicacion: x.ubicacion, ajuste_pct: x.ajuste_pct, notas: x.notas,
      lineas: x.lineas.map((l) => sinVacios({ partida_id: l.partida_id, descripcion: l.descripcion, unidad: l.unidad, cantidad: num(l.cantidad), precio: num(l.precio), material_pct: num(l.material_pct), jornadas_ud: num(l.jornadas_ud) })) };
    Object.keys(p).forEach((k) => (p[k] === undefined || p[k] === '') && delete p[k]);
    if (!x.id && (!p.codigo || !p.titulo)) { toast('Pon código y trabajo.'); return; }
    await act(p, (r) => 'Presupuesto guardado · ' + eur2.format(num(((r && r.totales) || totalesPres(x)).total)) + '.');
    const nuevo = (D().presupuestos || []).find((y) => String(y.codigo).toLowerCase() === String(x.codigo).toLowerCase());
    if (nuevo) { abrirPres(nuevo.id); render(); }
  }
}, true);

/* ---------- lectura de documentos con IA (/api/doc → n8n «R4 · Documentos IA») ---------- */
async function aBase64(file) {
  if (/^image\//.test(file.type)) {   // fotos: se reducen a 1600 px en JPEG para que viajen rápido
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = URL.createObjectURL(file); });
    const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { tipo: 'image/jpeg', datos: c.toDataURL('image/jpeg', 0.82).split(',')[1] };
  }
  const buf = new Uint8Array(await file.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { tipo: file.type || 'application/pdf', datos: btoa(s) };
}
async function leerIA(file, obraSel) {
  if (!file || !file.size) { toast('Elige un PDF o una foto.'); return; }
  if (file.size > 3.2 * 1024 * 1024 && !/^image\//.test(file.type)) { toast('El PDF pasa de 3 MB: envíalo por partes o como foto.'); return; }
  ui.iaBusy = true; render();
  const fijar = (r) => { const obras = D().obras || []; const obra = obraSel ? obraDe(obraSel) : obras.find((o) => r.codigo_obra && String(o.codigo).toLowerCase() === String(r.codigo_obra).toLowerCase()); ui.ia = Object.assign(r, { obra: obra || null, archivo: file.name.slice(0, 120), origen: /^image\//.test(file.type) ? 'foto' : 'pdf' }); };
  try {
    if (!isLive()) {
      await new Promise((ok) => setTimeout(ok, 700));
      fijar({ demo: true, proveedor: 'Morteros Técnicos Baleares', fecha: hoyISO(), numero: 'FA-2611-0457', codigo_obra: '36', tipo_documento: 'factura', categoria: 'material', tipo_coste: 'directo', base_imponible: 642.5, iva: 134.93, total: 777.43, lineas: [{ concepto: 'Mortero de reparación R4 (25 sacos)', importe: 512.5 }, { concepto: 'Puente de unión epoxi', importe: 130 }] });
    } else {
      const { tipo, datos } = await aBase64(file);
      const r = await R.api('/api/doc', { method: 'POST', body: JSON.stringify({ nombre: file.name.slice(0, 120), tipo, datos }) });
      fijar(r.documento || r);
    }
  } catch (err) { ui.ia = { error: err.status === 404 || err.status === 502 ? 'El lector de documentos aún no está publicado en n8n («R4 · Documentos IA»).' : err.message }; }
  ui.iaBusy = false; render();
}
})();
