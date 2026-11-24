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
ROLLBACK;
