// Validación de las operaciones de gestión v1.5 (obras, partes, costes, almacén, certificaciones, presupuestos).
// Cada campo se limpia y se pasa como texto: Postgres hace los CAST. Lo que no está en SPEC no llega a la BD.
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Número en formato español o normal: 48.000 · 48.000,50 · 12,5 · 12.5 · 1200
export function numES(v) {
  if (typeof v === 'number') return v;
  let x = String(v ?? '').trim().replace(/\s|€/g, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g, '').replace(',', '.');
  else x = x.replace(',', '.');
  return x === '' ? NaN : Number(x);
}
const fechaOk = (v) => { if (!RE_DATE.test(v)) return false; const d = new Date(v + 'T12:00:00Z'); return !Number.isNaN(d) && d.toISOString().slice(0, 10) === v; };
const E = (a) => ({ t: 'enum', set: new Set(a) });
const CAT_COSTE = ['material', 'gasolina', 'mano_obra', 'subcontrata', 'alquiler', 'nomina_estructura', 'seguro', 'prevencion', 'oficina', 'vehiculo', 'herramientas', 'otros'];
const ORIGEN = ['manual', 'excel', 'pdf', 'foto', 'gmail', 'atlas', 'almacen'];

// Tipos: id (entero > 0), num[min,max], date, txt(max), enum, url (https), bool. «!» = obligatorio.
const F = {
  id: { t: 'id' }, num: (min, max) => ({ t: 'num', min, max }), txt: (max) => ({ t: 'txt', max }), date: { t: 'date' },
  url: { t: 'url' }, bool: { t: 'bool' }
};
const COSTE = {
  tipo: { ...E(['directo', 'indirecto']), req: true }, categoria: E(CAT_COSTE), obra_id: F.id, concepto: { ...F.txt(300), req: true },
  proveedor: F.txt(120), importe: { ...F.num(-1e7, 1e7), req: true }, fecha: F.date, periodicidad: E(['puntual', 'mensual', 'anual']),
  origen: E(ORIGEN), documento: F.txt(300)
};
const LINEA = {
  partida_id: F.id, descripcion: { ...F.txt(300), req: true }, unidad: F.txt(12), cantidad: F.num(0, 1e6), precio: F.num(0, 1e7),
  material_pct: F.num(0, 100), jornadas_ud: F.num(0, 1000)
};
export const SPEC = {
  operario_set: { id: F.id, nombre: F.txt(80), categoria: E(['oficial', 'peon', 'encargado']), coste_mensual: F.num(0, 50000), telefono: F.txt(30), activo: F.bool, _nuevo: ['nombre'] },
  obra_set: {
    id: F.id, codigo: { t: 'txt', max: 40, re: /^[\p{L}\p{N} ._\-/]+$/u }, titulo: F.txt(200), cliente_id: F.id, oportunidad_id: F.id, ubicacion: F.txt(200),
    estado: E(['planificada', 'en_curso', 'parada', 'terminada', 'facturada']), fecha_inicio: F.date, oficiales: { t: 'int', min: 0, max: 50 }, peones: { t: 'int', min: 0, max: 50 },
    periodo_control: E(['diario', 'semanal', 'quincenal']), presupuesto_url: F.url, notas: F.txt(2000),
    importe: F.num(0, 1e8), jornadas: F.num(0, 100000), material: F.num(0, 1e8), _nuevo: ['codigo', 'titulo']
  },
  obra_version: { obra_id: { ...F.id, req: true }, linea: { t: 'linea' }, importe: { ...F.num(0, 1e8), req: true }, jornadas: F.num(0, 100000), material: F.num(0, 1e8), motivo: F.txt(300) },
  parte_set: { obra_id: { ...F.id, req: true }, fecha: { ...F.date, req: true }, operarios: { t: 'lista', max: 80, item: { id: { ...F.id, req: true }, categoria: E(['oficial', 'peon', 'encargado']), jornadas: E(['0.5', '1', '1.5']) } } },
  coste_add: { ...COSTE, costes: { t: 'lista', max: 300, item: COSTE }, _lote: true },
  coste_del: { id: { ...F.id, req: true } },
  articulo_set: { id: F.id, nombre: F.txt(120), unidad: F.txt(12), coste_unitario: F.num(0, 1e6), minimo: F.num(0, 1e6), _nuevo: ['nombre'] },
  movimiento_add: { articulo_id: { ...F.id, req: true }, tipo: { ...E(['entrada', 'salida']), req: true }, cantidad: { ...F.num(0.01, 1e6), req: true }, obra_id: F.id, coste_unitario: F.num(0, 1e6), fecha: F.date, origen: E(['manual', 'atlas', 'pdf', 'foto']), nota: F.txt(300) },
  cert_set: { id: F.id, obra_id: F.id, tipo: E(['parcial', 'final']), fecha: F.date, importe: F.num(0, 1e8), notas: F.txt(1000), _nuevo: ['obra_id', 'importe'] },
  cert_estado: { id: { ...F.id, req: true }, estado: { ...E(['borrador', 'enviada', 'conforme', 'facturada']), req: true } },
  cert_conforme: { id: { ...F.id, req: true } },
  partida_set: { id: F.id, codigo: F.txt(20), descripcion: F.txt(200), unidad: F.txt(12), precio: { t: 'num', min: 0, max: 1e6, vacio: true }, material_pct: F.num(0, 100), jornadas_ud: F.num(0, 1000), familia: F.txt(60), activo: F.bool, _nuevo: ['codigo', 'descripcion'] },
  presupuesto_set: {
    id: F.id, codigo: { t: 'txt', max: 40, re: /^[\p{L}\p{N} ._\-/]+$/u }, titulo: F.txt(200), cliente_id: F.id, oportunidad_id: F.id, ubicacion: F.txt(200),
    ajuste_pct: F.num(-50, 200), notas: F.txt(2000), lineas: { t: 'lista', max: 200, item: LINEA }, _nuevo: ['codigo', 'titulo']
  },
  presupuesto_estado: { id: { ...F.id, req: true }, estado: { ...E(['borrador', 'enviado', 'rechazado', 'aceptado']), req: true }, fecha_inicio: F.date }
};
export const OPS_GESTION = new Set(Object.keys(SPEC));

function campo(k, v, s) {
  if (s.t === 'id') { const n = Number(v); return Number.isSafeInteger(n) && n > 0 && n < 1e12 && /^\d+$/.test(String(v)) ? [String(n)] : [null, k + ' no válido']; }
  if (s.t === 'int') { const n = Number(v); return Number.isInteger(n) && n >= s.min && n <= s.max && /^\d+$/.test(String(v)) ? [String(n)] : [null, k + ' debe ser un número entero']; }
  if (s.t === 'num') {
    if (s.vacio && (v === '' || v === null)) return [''];
    const n = numES(v);
    return Number.isFinite(n) && n >= s.min && n <= s.max ? [String(n)] : [null, k + ' fuera de rango'];
  }
  if (s.t === 'date') return typeof v === 'string' && fechaOk(v) ? [v] : [null, k + ' debe ser una fecha AAAA-MM-DD'];
  if (s.t === 'txt') { const x = String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, s.max); return s.re && x && !s.re.test(x) ? [null, k + ' con caracteres no válidos'] : [x]; }
  if (s.t === 'enum') return s.set.has(String(v)) ? [String(v)] : [null, k + ' no válido'];
  if (s.t === 'url') { const x = String(v ?? '').trim(); return x === '' || /^https:\/\/[^\s"'<>]{3,490}$/.test(x) ? [x] : [null, k + ' debe ser un enlace https']; }
  if (s.t === 'bool') return typeof v === 'boolean' ? [v] : [null, k + ' debe ser sí/no'];
  if (s.t === 'linea') return v === 'nueva' || /^\d{1,3}$/.test(String(v)) ? [String(v)] : [null, 'línea no válida'];
  return [null, k + ' no admitido'];
}
function objeto(input, spec) {
  const out = {};
  for (const [k, s] of Object.entries(spec)) {
    if (k.startsWith('_')) continue;
    const v = input[k];
    if (v === undefined || (v === '' && s.t !== 'txt' && s.t !== 'url' && !s.vacio)) { if (s.req) return { error: 'falta ' + k }; continue; }
    if (s.t === 'lista') {
      if (!Array.isArray(v)) return { error: k + ' debe ser una lista' };
      if (v.length > s.max) return { error: 'demasiados elementos en ' + k + ' (máx. ' + s.max + ')' };
      const arr = [];
      for (const it of v) { const r = objeto(it && typeof it === 'object' ? it : {}, s.item); if (r.error) return r; arr.push(r.obj); }
      out[k] = arr; continue;
    }
    const [val, err] = campo(k, v, s);
    if (err) return { error: err };
    if (s.req && (val === '' || val === null)) return { error: 'falta ' + k };
    out[k] = val;
  }
  if (spec._nuevo && !out.id) for (const k of spec._nuevo) if (!out[k]) return { error: 'falta ' + k };
  return { obj: out };
}
export function payloadGestion(op, input) {
  const spec = SPEC[op];
  if (spec._lote && Array.isArray(input.costes)) {
    const r = objeto({ costes: input.costes }, { costes: spec.costes });
    if (r.error) return r;
    if (!r.obj.costes.length) return { error: 'no hay costes que guardar' };
    return { payload: { op, costes: r.obj.costes } };
  }
  const base = spec._lote ? Object.fromEntries(Object.entries(spec).filter(([k]) => k !== 'costes')) : spec;
  const r = objeto(input, base);
  if (r.error) return r;
  if (op === 'movimiento_add' && r.obj.tipo === 'salida' && !r.obj.obra_id) return { error: 'indica la obra de destino' };
  if (op === 'parte_set' && r.obj.operarios) {   // un operario una sola vez por día y obra
    const vistos = new Set(); r.obj.operarios = r.obj.operarios.filter((o) => !vistos.has(o.id) && vistos.add(o.id));
  }
  return { payload: { op, ...r.obj } };
}
