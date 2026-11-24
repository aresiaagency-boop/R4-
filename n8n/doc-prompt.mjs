// Lector de documentos de R4 (facturas, albaranes, tickets, nóminas) · usado por el flujo «R4 · Documentos IA»
export const DOC_VERSION = 'doc-v1.0';
export const DOC_PROMPT = `Eres el lector de documentos de R4 Rehabilitación de Estructuras (Mallorca, España).
Recibes facturas, albaranes y tickets de proveedores (materiales, gasolina, alquileres, subcontratas) y a veces nóminas o recibos de seguros.
Extrae SOLO lo que aparece en el documento; si un dato no aparece, usa cadena vacía o 0. No inventes.
- proveedor: razón social de quien EMITE el documento (nunca R4).
- fecha: fecha de emisión en formato AAAA-MM-DD.
- numero: número de factura, albarán o ticket.
- codigo_obra: código de obra de R4 si aparece (p. ej. «Obra 36», «Ref. obra: 36», «O-36», «Pedido obra 36» → «36»). Solo el código.
- base_imponible: importe sin IVA. iva: cuota de IVA. total: importe total con IVA.
- lineas: conceptos principales (máx. 12) con su importe sin IVA.
- categoria: material, gasolina, alquiler, subcontrata, nomina_estructura, seguro, prevencion, oficina, vehiculo, herramientas u otros.
- tipo_coste: «directo» si es material, gasolina, alquiler o subcontrata para una obra; «indirecto» si es estructura (oficina, seguros, prevención, nóminas de oficina, ordenadores).`;
export const DOC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['proveedor', 'fecha', 'numero', 'codigo_obra', 'tipo_documento', 'categoria', 'tipo_coste', 'base_imponible', 'iva', 'total', 'lineas'],
  properties: {
    proveedor: { type: 'string' }, fecha: { type: 'string' }, numero: { type: 'string' }, codigo_obra: { type: 'string' },
    tipo_documento: { type: 'string', enum: ['factura', 'albaran', 'ticket', 'nomina', 'recibo', 'otro'] },
    categoria: { type: 'string', enum: ['material', 'gasolina', 'alquiler', 'subcontrata', 'nomina_estructura', 'seguro', 'prevencion', 'oficina', 'vehiculo', 'herramientas', 'otros'] },
    tipo_coste: { type: 'string', enum: ['directo', 'indirecto'] },
    base_imponible: { type: 'number' }, iva: { type: 'number' }, total: { type: 'number' },
    lineas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['concepto', 'importe'], properties: { concepto: { type: 'string' }, importe: { type: 'number' } } } }
  }
};
