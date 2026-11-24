-- Datos de ejemplo de gestión para pruebas LOCALES (nunca en producción). Requiere schema.sql.
BEGIN;
UPDATE r4_config SET valor = '150' WHERE clave = 'coste_jornada_oficial';
UPDATE r4_config SET valor = '120' WHERE clave = 'coste_jornada_peon';
INSERT INTO operarios (nombre, categoria, coste_mensual) VALUES ('Andrés Ruiz','oficial',3150),('Miguel Ferrer','oficial',3050),('Pau Riera','oficial',3100),
  ('Iván Moll','peon',2520),('Toni Serra','peon',2480),('Joan Vidal','encargado',3600) ON CONFLICT DO NOTHING;
INSERT INTO clientes (nombre, empresa, email, origen) SELECT 'Cliente Portal', 'CP Edificio Neptuno', 'cliente.portal@gmail.example', 'manual'
  WHERE NOT EXISTS (SELECT 1 FROM clientes WHERE email = 'cliente.portal@gmail.example');
SELECT r4_api(jsonb_build_object('op','obra_set','codigo','36','titulo','Mecanovigas en forjado de garaje','ubicacion','C/ Neptú 12, s''Arenal','estado','en_curso',
  'fecha_inicio', (date_trunc('week', current_date)::date - 14)::text,'oficiales','2','peones','1','importe','48000','jornadas','30','material','12000',
  'cliente_id',(SELECT id FROM clientes WHERE email='cliente.portal@gmail.example')::text,'actor',jsonb_build_object('via','password')));
SELECT r4_api(jsonb_build_object('op','obra_version','obra_id',(SELECT id FROM obras WHERE codigo='36'),'linea','0','importe','45000','jornadas','27','material','11000','motivo','Medición en obra: 80 mecanovigas en vez de 100','actor',jsonb_build_object('via','password')));
SELECT r4_api(jsonb_build_object('op','obra_version','obra_id',(SELECT id FROM obras WHERE codigo='36'),'linea','nueva','importe','3200','jornadas','3','material','900','motivo','Extra: apuntalamiento adicional','actor',jsonb_build_object('via','password')));
SELECT r4_api(jsonb_build_object('op','obra_set','codigo','31','titulo','Reparación de pilares con aluminosis','ubicacion','C/ Son Ferriol 8, Palma','estado','en_curso',
  'fecha_inicio',(date_trunc('week', current_date)::date - 28)::text,'oficiales','2','peones','1','importe','48600','jornadas','51','material','14000','actor',jsonb_build_object('via','password')));
SELECT r4_api(jsonb_build_object('op','obra_set','codigo','38','titulo','Refuerzo de pilar para reforma de local','ubicacion','Palma','estado','planificada',
  'fecha_inicio',(date_trunc('week', current_date)::date + 14)::text,'oficiales','1','peones','1','importe','21700','jornadas','12','material','7000','actor',jsonb_build_object('via','password')));
-- partes: obra 36 desde hace dos semanas hasta ayer (3 operarios), obra 31 hasta hace 10 días (control pendiente)
INSERT INTO partes (obra_id, fecha, operario_id, categoria, jornadas, created_by)
SELECT o.id, d::date, op.id, op.categoria, 1, 'seed' FROM obras o
  JOIN generate_series(date_trunc('week', current_date)::date - 14, current_date - 1, interval '1 day') d ON extract(isodow FROM d) <= 5
  JOIN operarios op ON op.nombre IN ('Andrés Ruiz','Miguel Ferrer','Iván Moll') WHERE o.codigo = '36' ON CONFLICT DO NOTHING;
INSERT INTO partes (obra_id, fecha, operario_id, categoria, jornadas, created_by)
SELECT o.id, d::date, op.id, op.categoria, 1, 'seed' FROM obras o
  JOIN generate_series(date_trunc('week', current_date)::date - 28, date_trunc('week', current_date)::date - 10, interval '1 day') d ON extract(isodow FROM d) <= 5
  JOIN operarios op ON op.nombre IN ('Pau Riera','Toni Serra','Joan Vidal') WHERE o.codigo = '31' ON CONFLICT DO NOTHING;
SELECT r4_api(jsonb_build_object('op','coste_add','costes',jsonb_build_array(
  jsonb_build_object('tipo','directo','categoria','material','obra_id',(SELECT id FROM obras WHERE codigo='36'),'concepto','Kit Mecanoviga 80 uds','proveedor','Mecanoviga','importe','6200','origen','pdf'),
  jsonb_build_object('tipo','directo','categoria','gasolina','obra_id',(SELECT id FROM obras WHERE codigo='36'),'concepto','Tarjetas de combustible','importe','180'),
  jsonb_build_object('tipo','directo','categoria','material','obra_id',(SELECT id FROM obras WHERE codigo='31'),'concepto','Morteros de reparación','proveedor','Sika','importe','5200','origen','pdf'),
  jsonb_build_object('tipo','indirecto','categoria','seguro','concepto','Seguro de responsabilidad civil','importe','1200','periodicidad','anual','origen','excel'),
  jsonb_build_object('tipo','indirecto','categoria','prevencion','concepto','Empresa de prevención de riesgos','importe','1000','periodicidad','anual','origen','excel'),
  jsonb_build_object('tipo','indirecto','categoria','nomina_estructura','concepto','Nóminas de estructura','importe','9800','periodicidad','mensual','origen','excel'),
  jsonb_build_object('tipo','indirecto','categoria','oficina','concepto','Oficina, ordenadores y software','importe','950','periodicidad','mensual')),
  'actor',jsonb_build_object('via','password')));
SELECT r4_api('{"op":"articulo_set","nombre":"Saco de mortero de reparación","unidad":"saco","coste_unitario":"8.5","minimo":"10","actor":{"via":"password"}}'::jsonb);
SELECT r4_api('{"op":"articulo_set","nombre":"Resina epoxi","unidad":"kg","coste_unitario":"14","minimo":"10","actor":{"via":"password"}}'::jsonb);
SELECT r4_api(jsonb_build_object('op','movimiento_add','articulo_id',(SELECT id FROM articulos WHERE nombre='Saco de mortero de reparación'),'tipo','entrada','cantidad','20','actor',jsonb_build_object('via','password')));
SELECT r4_api(jsonb_build_object('op','movimiento_add','articulo_id',(SELECT id FROM articulos WHERE nombre='Saco de mortero de reparación'),'tipo','salida','cantidad','3','obra_id',(SELECT id FROM obras WHERE codigo='36'),'nota','Me llevo 3 sacos para la obra 36','actor',jsonb_build_object('via','password')));
SELECT r4_api(jsonb_build_object('op','cert_set','obra_id',(SELECT id FROM obras WHERE codigo='36'),'tipo','parcial','importe','18000','notas','Mecanovigas ejes 1 a 4','actor',jsonb_build_object('via','password')));
SELECT r4_api(jsonb_build_object('op','cert_estado','id',(SELECT max(id) FROM certificaciones),'estado','enviada','actor',jsonb_build_object('via','password')));
UPDATE partidas SET precio = 95, material_pct = 55, jornadas_ud = 0.35 WHERE codigo = 'MV-01';
UPDATE partidas SET precio = 12, material_pct = 25, jornadas_ud = 0.06 WHERE codigo = 'AP-01';
UPDATE partidas SET precio = 140, material_pct = 35, jornadas_ud = 0.6 WHERE codigo = 'VC-01';
SELECT r4_api(jsonb_build_object('op','presupuesto_set','codigo','39','titulo','Mecanovigas y viga castellana','ajuste_pct','20','origen','atlas','lineas',jsonb_build_array(
  jsonb_build_object('partida_id',(SELECT id FROM partidas WHERE codigo='MV-01'),'descripcion','Mecanoviga · refuerzo de vigueta','unidad','ml','cantidad','9.6','precio','95','material_pct','55','jornadas_ud','0.35'),
  jsonb_build_object('partida_id',(SELECT id FROM partidas WHERE codigo='VC-01'),'descripcion','Reparación de viga castellana','unidad','ml','cantidad','8','precio','140','material_pct','35','jornadas_ud','0.6'),
  jsonb_build_object('partida_id',(SELECT id FROM partidas WHERE codigo='AP-01'),'descripcion','Apuntalamiento provisional','unidad','m²','cantidad','60','precio','12','material_pct','25','jornadas_ud','0.06')),
  'actor',jsonb_build_object('via','password')));
COMMIT;
