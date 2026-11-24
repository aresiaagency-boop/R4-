-- Prueba de extremo a extremo de las funciones r4_* (ejecutar en una BD de pruebas, NO en producción)
-- psql -d r4test -v ON_ERROR_STOP=1 -f db/test_flow.sql
\set ON_ERROR_STOP 1
BEGIN;
UPDATE r4_config SET valor = 'https://evo.example.test' WHERE clave = 'evolution_url';
UPDATE r4_config SET valor = 'atlasr4' WHERE clave = 'evolution_instancia';
UPDATE r4_config SET valor = '34600000000' WHERE clave = 'wa_destino_direccion';

-- 1. ingesta nueva + duplicada
SELECT r4_ingest('{"canal":"gmail","external_id":"t-1","remitente_nombre":"Carmen Vidal","remitente_email":"C.Vidal@Fincas.example","asunto":"Grietas en vigas, con comas, y más","cuerpo":"Hola, tel 600 000 101","recibido_at":"2026-11-23T08:01:00Z"}'::jsonb) AS ingesta1;
SELECT r4_ingest('{"canal":"gmail","external_id":"t-1"}'::jsonb) AS ingesta_dup;
SELECT r4_ingest('{"canal":"gmail","external_id":"t-2","asunto":"Newsletter","recibido_at":"fecha-mala"}'::jsonb) AS ingesta_fecha_mala;

-- 2. extracción cliente
SELECT r4_aplicar_extraccion(jsonb_build_object('id', (SELECT id FROM mensajes WHERE external_id='t-1'),
  'extraccion', '{"es_cliente":true,"nombre":"Carmen Vidal","empresa":"AF Portixol","email":"","telefono":"+34 600 000 101","servicio":"Reparación del hormigón armado","urgencia":"alta","titulo":"Grietas en vigas del garaje","resumen":"Pide visita"}'::jsonb)) AS extr_cliente;

-- 3. extracción no cliente
SELECT r4_aplicar_extraccion(jsonb_build_object('id', (SELECT id FROM mensajes WHERE external_id='t-2'),
  'extraccion', '{"es_cliente":false,"motivo":"boletín"}'::jsonb)) AS extr_no_cliente;

-- 4. segundo correo del mismo cliente (mismo email en otra forma) -> misma ficha y oportunidad
SELECT r4_ingest('{"canal":"gmail","external_id":"t-3","remitente_email":"c.vidal@fincas.example","asunto":"Re: grietas"}'::jsonb);
SELECT r4_aplicar_extraccion(jsonb_build_object('id', (SELECT id FROM mensajes WHERE external_id='t-3'),
  'extraccion', '{"es_cliente":true,"resumen":"Confirma visita"}'::jsonb))->>'cliente_id' AS cli_repetido;
SELECT count(*) AS n_clientes, (SELECT count(*) FROM oportunidades) AS n_oportunidades FROM clientes;

-- 5. marcar WA
SELECT r4_marcar_wa(jsonb_build_object('id', (SELECT id FROM mensajes WHERE external_id='t-1'), 'ok', true));
SELECT r4_marcar_wa(jsonb_build_object('id', (SELECT id FROM mensajes WHERE external_id='t-3'), 'ok', false, 'detalle', 'HTTP 401'));

-- 6. API
SELECT r4_api('{"op":"set_config","config":{"wa_campos":"nombre,telefono,resumen","clave_no_permitida":"x"}}'::jsonb || '{"actor":{"via":"password"}}'::jsonb)->'config'->>'wa_campos' AS campos;
SELECT r4_api(jsonb_build_object('op','update_extraccion','id',(SELECT id FROM mensajes WHERE external_id='t-1'),'extraccion','{"empresa":"Administración de Fincas Portixol"}'::jsonb) || '{"actor":{"via":"password"}}'::jsonb)->>'ok' AS upd;
SELECT r4_api(jsonb_build_object('op','reenviar_wa','id',(SELECT id FROM mensajes WHERE external_id='t-1')) || '{"actor":{"via":"password"}}'::jsonb)->>'enviar_wa' AS reenviar;
SELECT r4_api(jsonb_build_object('op','set_etapa','id',(SELECT min(id) FROM oportunidades),'etapa','visita') || '{"actor":{"via":"password"}}'::jsonb)->>'ok' AS etapa;
SELECT r4_api('{"op":"nada"}'::jsonb || '{"actor":{"via":"password"}}'::jsonb) AS desconocida;
SELECT jsonb_pretty(r4_api('{"op":"summary"}'::jsonb || '{"actor":{"via":"password"}}'::jsonb)->'data'->'kpis') AS kpis;
SELECT jsonb_array_length(r4_summary()->'mensajes') AS n_msgs, jsonb_array_length(r4_summary()->'eventos') AS n_eventos,
       (SELECT count(*) FROM r4_config WHERE clave='clave_no_permitida') AS clave_colada;
-- 7. CRM de la Propuesta: organización, inmueble, alerta IEE, pérdida con motivo
SELECT (SELECT count(*) FROM organizaciones WHERE lower(nombre) = 'af portixol') AS org_creada,
       (SELECT count(*) FROM organizaciones WHERE lower(nombre) = 'particular') AS particular_no_crea_org;
SELECT r4_ingest('{"canal":"gmail","external_id":"t-5","remitente_email":"otra@comunidad.example","asunto":"Fachada"}'::jsonb);
SELECT r4_aplicar_extraccion(jsonb_build_object('id', (SELECT id FROM mensajes WHERE external_id='t-5'),
  'extraccion', '{"es_cliente":true,"nombre":"Joan","empresa":"CP Neptú 12","tipo_cliente":"comunidad","direccion_obra":"C/ Neptú 12","municipio":"s''Arenal","resumen":"Fachada"}'::jsonb))->>'inmueble_id' IS NOT NULL AS inmueble_creado;
SELECT r4_api(jsonb_build_object('op','update_inmueble','id',(SELECT id FROM inmuebles WHERE direccion='C/ Neptú 12'),'anio_construccion','1968','iee_fecha','basura') || '{"actor":{"via":"password"}}'::jsonb)->>'ok' AS upd_inmueble;
SELECT r4_summary()->'inmuebles'->0->>'alerta_iee' AS alerta, (r4_summary()->'kpis'->>'alertas_iee')::int AS n_alertas;
SELECT r4_alerta_iee(1990, current_date - 3650) AS renovar, r4_alerta_iee(2010, NULL) AS ok_reciente, r4_alerta_iee(NULL, NULL) AS sin_datos;
SELECT r4_api(jsonb_build_object('op','set_etapa','id',(SELECT max(id) FROM oportunidades),'etapa','perdido','motivo','Precio') || '{"actor":{"via":"password"}}'::jsonb)->>'ok' AS perdido;
SELECT motivo_perdida AS motivo FROM oportunidades WHERE id = (SELECT max(id) FROM oportunidades);
-- 8. Login con Google y control de Dirección
SELECT r4_api('{"op":"auth_login","email":"Jefa@R4.example","nombre":"Jefa R4","direccion":true}'::jsonb)->>'estado' AS dir_activa;
SELECT r4_api('{"op":"auth_login","email":"tecnico@r4.example","nombre":"Técnico"}'::jsonb)->>'estado' AS tecnico_pendiente;
SELECT r4_api('{"op":"summary","actor":{"email":"tecnico@r4.example","via":"google"}}'::jsonb)->>'error' AS pendiente_sin_acceso;
SELECT r4_api('{"op":"usuario_set","email":"tecnico@r4.example","rol":"tecnico","estado":"activo","actor":{"email":"tecnico@r4.example","via":"google"}}'::jsonb)->>'error' AS no_autoaprobarse;
SELECT r4_api('{"op":"usuario_set","email":"tecnico@r4.example","rol":"tecnico","estado":"activo","actor":{"email":"jefa@r4.example","via":"google"}}'::jsonb)->>'estado' AS aprobado;
SELECT r4_api('{"op":"auth_login","email":"tecnico@r4.example","nombre":"Técnico"}'::jsonb)->>'rol' AS rol_tras_login;
SELECT (r4_api('{"op":"summary","actor":{"email":"tecnico@r4.example","via":"google"}}'::jsonb)->'data'->'usuarios') IS NULL OR (r4_api('{"op":"summary","actor":{"email":"tecnico@r4.example","via":"google"}}'::jsonb)->'data'->>'usuarios') IS NULL AS tecnico_no_ve_usuarios;
SELECT jsonb_array_length(r4_api('{"op":"summary","actor":{"email":"jefa@r4.example","via":"google"}}'::jsonb)->'data'->'usuarios') AS dir_ve_usuarios;
SELECT r4_api('{"op":"set_config","config":{"eco_activo":"false"},"actor":{"email":"tecnico@r4.example","via":"google"}}'::jsonb)->>'error' AS tecnico_no_config;
SELECT r4_api('{"op":"usuario_set","email":"tecnico@r4.example","rol":"administracion","actor":{"email":"jefa@r4.example","via":"google"}}'::jsonb)->>'rol' AS cambio_rol;
SELECT r4_api(jsonb_build_object('op','set_etapa','id',1,'etapa','visita','actor',jsonb_build_object('email','tecnico@r4.example','via','google')))->>'error' AS admin_solo_lectura;
SELECT r4_api('{"op":"usuario_set","email":"tecnico@r4.example","estado":"bloqueado","actor":{"email":"jefa@r4.example","via":"google"}}'::jsonb)->>'estado' AS bloqueado;
SELECT r4_api('{"op":"summary","actor":{"email":"tecnico@r4.example","via":"google"}}'::jsonb)->>'auth' AS bloqueo_inmediato;
SELECT r4_api('{"op":"auth_login","email":"tecnico@r4.example"}'::jsonb)->>'estado' AS login_bloqueado;
SELECT r4_api('{"op":"summary","actor":{"email":"direccion","via":"password"}}'::jsonb)->'data'->'yo'->>'rol' AS emergencia_password;

-- 8b) Endurecimiento: sin actor no hay acceso; solo lectura no ve solicitudes ni números
SELECT r4_api('{"op":"summary"}'::jsonb)->>'auth' AS sin_actor_sin_acceso;
SELECT (r4_api('{"op":"summary","actor":{"email":"","via":"password"}}'::jsonb)->>'ok') AS password_ok;
INSERT INTO usuarios (email, rol, estado) VALUES ('lectura@r4.test', 'colaborador', 'activo') ON CONFLICT (email) DO UPDATE SET rol = 'colaborador', estado = 'activo';
UPDATE r4_config SET valor = '34600111222' WHERE clave = 'wa_destino_direccion';
SELECT r4_api('{"op":"summary","actor":{"email":"lectura@r4.test","via":"google"}}'::jsonb)->'data'->'config'->>'wa_destino_direccion' AS wa_enmascarado;
SELECT (SELECT count(*) FROM jsonb_array_elements(r4_api('{"op":"summary","actor":{"email":"lectura@r4.test","via":"google"}}'::jsonb)->'data'->'eventos') e WHERE e->>'ref' LIKE 'usuario:%') AS eventos_acceso_visibles;
SELECT r4_auth_login(jsonb_build_object('email','largo@gmail.test','nombre', repeat('x', 200)))->>'estado' AS largo_pendiente;
SELECT length(nombre) AS nombre_recortado FROM usuarios WHERE email = 'largo@gmail.test';

-- 9) Gestión v1.5 (notas de voz): obra con cuadrilla, partes, mod/ext, costes, almacén, certificación, presupuesto y portal cliente
UPDATE r4_config SET valor = '150' WHERE clave = 'coste_jornada_oficial';
UPDATE r4_config SET valor = '120' WHERE clave = 'coste_jornada_peon';
INSERT INTO usuarios (email, rol, estado) VALUES ('sonia@r4.test', 'administracion', 'activo'), ('encargado@r4.test', 'encargado', 'activo'),
  ('comercial@r4.test', 'comercial', 'activo') ON CONFLICT (email) DO UPDATE SET rol = EXCLUDED.rol, estado = 'activo';
SELECT r4_api('{"op":"operario_set","nombre":"Oficial Uno","categoria":"oficial","coste_mensual":"3150","actor":{"email":"sonia@r4.test","via":"google"}}'::jsonb)->>'ok' AS operario1;
SELECT r4_api('{"op":"operario_set","nombre":"Peón Uno","categoria":"peon","actor":{"email":"sonia@r4.test","via":"google"}}'::jsonb)->>'ok' AS operario2;
SELECT r4_api('{"op":"operario_set","nombre":"Intruso","actor":{"email":"encargado@r4.test","via":"google"}}'::jsonb)->>'error' AS encargado_no_personal;
-- obra 36: 30 jornadas, cuadrilla 2+1 → 10 días laborables desde el lunes 2 nov 2026 → viernes 13 nov
SELECT r4_api('{"op":"obra_set","codigo":"36","titulo":"Mecanovigas garaje","fecha_inicio":"2026-11-02","oficiales":2,"peones":1,"importe":"48000","jornadas":"30","material":"12000","actor":{"via":"password"}}'::jsonb)->>'ok' AS obra36;
SELECT (o->>'fecha_fin') AS fin_calculado, (o->>'dias_previstos') AS dias FROM jsonb_array_elements(r4_obras_json(true)) o WHERE o->>'codigo' = '36';
-- parte de secretaría: 2 operarios el lunes
SELECT r4_api(jsonb_build_object('op','parte_set','obra_id',(SELECT id FROM obras WHERE codigo='36'),'fecha','2026-11-02',
  'operarios', jsonb_build_array(jsonb_build_object('id',(SELECT id FROM operarios WHERE nombre='Oficial Uno')), jsonb_build_object('id',(SELECT id FROM operarios WHERE nombre='Peón Uno'))),
  'actor', jsonb_build_object('email','sonia@r4.test','via','google')))->>'operarios' AS parte_operarios;
-- reemplazar el mismo día no duplica
SELECT r4_api(jsonb_build_object('op','parte_set','obra_id',(SELECT id FROM obras WHERE codigo='36'),'fecha','2026-11-02',
  'operarios', jsonb_build_array(jsonb_build_object('id',(SELECT id FROM operarios WHERE nombre='Oficial Uno'))),
  'actor', jsonb_build_object('email','encargado@r4.test','via','google')))->>'operarios' AS parte_reemplazado;
SELECT (o->>'jornadas_registradas') AS jornadas_reg, (o->>'avance') AS avance, (o->>'coste_mo') AS coste_mo, (o->>'estado') AS estado
  FROM jsonb_array_elements(r4_obras_json(true)) o WHERE o->>'codigo' = '36';
-- mod 1 del original (48.000 → 45.000, 27 jornadas) y extensión 1 (+3.000, 3 jornadas): manda el último mod
SELECT r4_api(jsonb_build_object('op','obra_version','obra_id',(SELECT id FROM obras WHERE codigo='36'),'linea','0','importe','45000','jornadas','27','material','11000','motivo','80 mecanovigas en vez de 100','actor',jsonb_build_object('via','password')))->>'version' AS mod1;
SELECT r4_api(jsonb_build_object('op','obra_version','obra_id',(SELECT id FROM obras WHERE codigo='36'),'linea','nueva','importe','2000','jornadas','2','motivo','Extra','actor',jsonb_build_object('via','password')))->>'linea' AS ext1;
SELECT (o->>'importe') AS importe_vigente, (o->>'jornadas_presupuesto') AS jornadas_vigentes FROM jsonb_array_elements(r4_obras_json(true)) o WHERE o->>'codigo' = '36';
-- costes: material de obra (encargado sí), indirecto (encargado no, secretaría sí)
SELECT r4_api(jsonb_build_object('op','coste_add','tipo','directo','categoria','material','obra_id',(SELECT id FROM obras WHERE codigo='36'),'concepto','Sacos de mortero','importe','500','actor',jsonb_build_object('email','encargado@r4.test','via','google')))->>'insertados' AS material_encargado;
SELECT r4_api('{"op":"coste_add","tipo":"indirecto","categoria":"seguro","concepto":"Seguro RC","importe":"1200","periodicidad":"anual","actor":{"email":"encargado@r4.test","via":"google"}}'::jsonb)->>'forbidden' AS indirecto_encargado;
SELECT r4_api('{"op":"coste_add","costes":[{"tipo":"indirecto","categoria":"seguro","concepto":"Seguro RC","importe":"1200","periodicidad":"anual","origen":"excel"},{"tipo":"indirecto","categoria":"nomina_estructura","concepto":"Nómina secretaría","importe":"2000","periodicidad":"mensual","origen":"excel"}],"actor":{"email":"sonia@r4.test","via":"google"}}'::jsonb)->>'insertados' AS lote_excel;
SELECT r4_kpis_costes()->>'ci_mensual' AS ci_mensual;
-- almacén: entrada de 10 sacos a 8 € y salida de 3 a la obra 36 → coste de material 24 €
SELECT r4_api('{"op":"articulo_set","nombre":"Saco mortero R4","unidad":"saco","coste_unitario":"8","actor":{"email":"encargado@r4.test","via":"google"}}'::jsonb)->>'ok' AS articulo;
SELECT r4_api(jsonb_build_object('op','movimiento_add','articulo_id',(SELECT id FROM articulos WHERE nombre='Saco mortero R4'),'tipo','entrada','cantidad','10','actor',jsonb_build_object('email','encargado@r4.test','via','google')))->>'stock' AS stock_entrada;
SELECT r4_api(jsonb_build_object('op','movimiento_add','articulo_id',(SELECT id FROM articulos WHERE nombre='Saco mortero R4'),'tipo','salida','cantidad','3','obra_id',(SELECT id FROM obras WHERE codigo='36'),'actor',jsonb_build_object('email','encargado@r4.test','via','google')))->>'stock' AS stock_salida;
SELECT (o->>'coste_material') AS coste_material_obra FROM jsonb_array_elements(r4_obras_json(true)) o WHERE o->>'codigo' = '36';
-- certificación final: borrador → enviada → (cliente) conforme → (Dirección) facturada
INSERT INTO clientes (nombre, email) VALUES ('Cliente Portal', 'cliente@r4.test');
UPDATE obras SET cliente_id = (SELECT id FROM clientes WHERE email = 'cliente@r4.test') WHERE codigo = '36';
SELECT r4_api(jsonb_build_object('op','cert_set','obra_id',(SELECT id FROM obras WHERE codigo='36'),'tipo','final','importe','48000','actor',jsonb_build_object('email','sonia@r4.test','via','google')))->>'ok' AS cert_borrador;
SELECT r4_api(jsonb_build_object('op','cert_estado','id',(SELECT max(id) FROM certificaciones),'estado','enviada','actor',jsonb_build_object('email','sonia@r4.test','via','google')))->>'estado' AS cert_enviada;
SELECT r4_api(jsonb_build_object('op','cert_estado','id',(SELECT max(id) FROM certificaciones),'estado','facturada','actor',jsonb_build_object('email','sonia@r4.test','via','google')))->>'forbidden' AS secretaria_no_factura;
-- el cliente pide acceso por «03 Clientes», Dirección lo aprueba vinculado a su ficha y da conformidad desde su portal
SELECT r4_auth_login('{"email":"cliente@r4.test","nombre":"Cliente Portal","solicitud":"cliente"}'::jsonb)->>'estado' AS cliente_pendiente;
SELECT solicitud FROM usuarios WHERE email = 'cliente@r4.test';
SELECT r4_api('{"op":"usuario_set","email":"cliente@r4.test","rol":"cliente","estado":"activo","actor":{"via":"password"}}'::jsonb)->>'rol' AS cliente_aprobado;
SELECT (r4_api('{"op":"summary","actor":{"email":"cliente@r4.test","via":"google"}}'::jsonb)->'data'->'portal'->'obras'->0->>'codigo') AS portal_obra,
       (r4_api('{"op":"summary","actor":{"email":"cliente@r4.test","via":"google"}}'::jsonb)->'data'->'portal'->'obras'->0) ? 'coste_mo' AS portal_ve_costes,
       (r4_api('{"op":"summary","actor":{"email":"cliente@r4.test","via":"google"}}'::jsonb)->'data') ? 'mensajes' AS portal_ve_bandeja;
SELECT r4_api(jsonb_build_object('op','cert_conforme','id',(SELECT max(id) FROM certificaciones),'actor',jsonb_build_object('email','cliente@r4.test','via','google')))->>'estado' AS cliente_conforme;
SELECT r4_api('{"op":"set_etapa","id":1,"etapa":"visita","actor":{"email":"cliente@r4.test","via":"google"}}'::jsonb)->>'forbidden' AS cliente_no_crm;
SELECT estado FROM obras WHERE codigo = '36';
SELECT r4_api(jsonb_build_object('op','cert_estado','id',(SELECT max(id) FROM certificaciones),'estado','facturada','actor',jsonb_build_object('via','password')))->>'estado' AS facturada;
-- presupuesto estándar: 3 mecanovigas × 3,20 m + 60 m² apuntalamiento, +20 % por acceso → aceptado → obra
UPDATE partidas SET precio = 100, material_pct = 50, jornadas_ud = 0.5 WHERE codigo = 'MV-01';
UPDATE partidas SET precio = 10, material_pct = 20, jornadas_ud = 0.05 WHERE codigo = 'AP-01';
SELECT r4_api(jsonb_build_object('op','presupuesto_set','codigo','37','titulo','Mecanovigas portal','ajuste_pct','20','lineas', jsonb_build_array(
   jsonb_build_object('partida_id',(SELECT id FROM partidas WHERE codigo='MV-01'),'descripcion','Mecanoviga','unidad','ml','cantidad','9.6','precio','100','material_pct','50','jornadas_ud','0.5'),
   jsonb_build_object('partida_id',(SELECT id FROM partidas WHERE codigo='AP-01'),'descripcion','Apuntalamiento','unidad','m²','cantidad','60','precio','10','material_pct','20','jornadas_ud','0.05')),
   'actor', jsonb_build_object('email','comercial@r4.test','via','google')))->'totales' AS totales_37;
SELECT r4_api(jsonb_build_object('op','presupuesto_estado','id',(SELECT id FROM presupuestos WHERE codigo='37'),'estado','aceptado','actor',jsonb_build_object('email','comercial@r4.test','via','google')))->>'forbidden' AS comercial_no_aprueba;
SELECT r4_api(jsonb_build_object('op','presupuesto_estado','id',(SELECT id FROM presupuestos WHERE codigo='37'),'estado','aceptado','fecha_inicio','2026-11-16','actor',jsonb_build_object('via','password')))->>'estado' AS aceptado_dir;
SELECT (o->>'importe') AS obra37_importe, (o->>'jornadas_presupuesto') AS obra37_jornadas FROM jsonb_array_elements(r4_obras_json(true)) o WHERE o->>'codigo' = '37';
-- visibilidad: el comercial no ve costes ni márgenes; el encargado no ve indirectos
SELECT (r4_api('{"op":"summary","actor":{"email":"comercial@r4.test","via":"google"}}'::jsonb)->'data'->'obras'->0) ? 'margen_directo' AS comercial_ve_margen,
       jsonb_array_length(r4_api('{"op":"summary","actor":{"email":"encargado@r4.test","via":"google"}}'::jsonb)->'data'->'costes') AS costes_encargado,
       (SELECT count(*) FROM jsonb_array_elements(r4_api('{"op":"summary","actor":{"email":"encargado@r4.test","via":"google"}}'::jsonb)->'data'->'costes') c WHERE c->>'tipo' = 'indirecto') AS indirectos_encargado;

-- 10) Endurecimiento v1.5 (revisión del Verifier)
SELECT (r4_api('{"op":"summary","actor":{"email":"encargado@r4.test","via":"google"}}'::jsonb)->'data') ? 'mensajes' AS encargado_ve_bandeja,
       (r4_api('{"op":"summary","actor":{"email":"comercial@r4.test","via":"google"}}'::jsonb)->'data'->'config') ? 'coste_jornada_oficial' AS comercial_ve_tarifas,
       (r4_api('{"op":"summary","actor":{"email":"sonia@r4.test","via":"google"}}'::jsonb)->'data'->'config') ? 'coste_jornada_oficial' AS secretaria_ve_tarifas;
SELECT r4_api(jsonb_build_object('op','parte_set','obra_id',(SELECT id FROM obras WHERE codigo='36'),'fecha','2020-01-06','operarios','[]'::jsonb,'actor',jsonb_build_object('email','encargado@r4.test','via','google')))->>'forbidden' AS encargado_parte_antiguo;
SELECT r4_api(jsonb_build_object('op','coste_add','tipo','directo','categoria','material','obra_id',(SELECT id FROM obras WHERE codigo='36'),'concepto','Abono','importe','-9000','actor',jsonb_build_object('email','encargado@r4.test','via','google')))->>'forbidden' AS encargado_negativo;
SELECT r4_api('{"op":"coste_add","tipo":"directo","categoria":"material","obra_id":999999,"concepto":"x","importe":"1","actor":{"via":"password"}}'::jsonb)->>'error' AS obra_inexistente;
SELECT r4_api('{"op":"doc_permiso","nombre":"f.pdf","actor":{"email":"encargado@r4.test","via":"google"}}'::jsonb)->>'ok' AS doc_encargado,
       r4_api('{"op":"doc_permiso","nombre":"f.pdf","actor":{"email":"comercial@r4.test","via":"google"}}'::jsonb)->>'forbidden' AS doc_comercial;
SELECT r4_api(jsonb_build_object('op','cert_set','obra_id',(SELECT id FROM obras WHERE codigo='36'),'tipo','parcial','importe','500','notas','interna','actor',jsonb_build_object('via','password')))->>'ok' AS cert_borrador_interna;
SELECT (SELECT count(*) FROM jsonb_array_elements(r4_api('{"op":"summary","actor":{"email":"cliente@r4.test","via":"google"}}'::jsonb)->'data'->'portal'->'obras'->0->'certificaciones') c
         WHERE c->>'estado' = 'borrador' OR c ? 'conforme_por') AS portal_borradores_o_conforme_por;
-- 12 filas mensuales del mismo concepto cuentan una vez
SELECT r4_kpis_costes()->>'ci_mensual' AS ci_antes;
SELECT r4_api(jsonb_build_object('op','coste_add','costes',(SELECT jsonb_agg(jsonb_build_object('tipo','indirecto','categoria','oficina','concepto','Alquiler oficina','importe','800','periodicidad','mensual','fecha',(date '2026-01-01' + (g || ' month')::interval)::date::text)) FROM generate_series(0, 11) g),'actor',jsonb_build_object('via','password')))->>'insertados' AS doce_meses;
SELECT r4_kpis_costes()->>'ci_mensual' AS ci_despues;
SELECT r4_api(jsonb_build_object('op','obra_set','id',(SELECT id FROM obras WHERE codigo='36'),'estado','facturada','actor',jsonb_build_object('email','sonia@r4.test','via','google')))->>'forbidden' AS secretaria_no_factura_obra;
ROLLBACK;
