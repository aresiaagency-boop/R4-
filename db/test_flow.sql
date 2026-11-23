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
SELECT r4_api('{"op":"set_config","config":{"wa_campos":"nombre,telefono,resumen","clave_no_permitida":"x"}}'::jsonb)->'config'->>'wa_campos' AS campos;
SELECT r4_api(jsonb_build_object('op','update_extraccion','id',(SELECT id FROM mensajes WHERE external_id='t-1'),'extraccion','{"empresa":"Administración de Fincas Portixol"}'::jsonb))->>'ok' AS upd;
SELECT r4_api(jsonb_build_object('op','reenviar_wa','id',(SELECT id FROM mensajes WHERE external_id='t-1')))->>'enviar_wa' AS reenviar;
SELECT r4_api(jsonb_build_object('op','set_etapa','id',(SELECT min(id) FROM oportunidades),'etapa','visita'))->>'ok' AS etapa;
SELECT r4_api('{"op":"nada"}'::jsonb) AS desconocida;
SELECT jsonb_pretty(r4_api('{"op":"summary"}'::jsonb)->'data'->'kpis') AS kpis;
SELECT jsonb_array_length(r4_summary()->'mensajes') AS n_msgs, jsonb_array_length(r4_summary()->'eventos') AS n_eventos,
       (SELECT count(*) FROM r4_config WHERE clave='clave_no_permitida') AS clave_colada;
-- 7. CRM de la Propuesta: organización, inmueble, alerta IEE, pérdida con motivo
SELECT (SELECT count(*) FROM organizaciones WHERE lower(nombre) = 'af portixol') AS org_creada,
       (SELECT count(*) FROM organizaciones WHERE lower(nombre) = 'particular') AS particular_no_crea_org;
SELECT r4_ingest('{"canal":"gmail","external_id":"t-5","remitente_email":"otra@comunidad.example","asunto":"Fachada"}'::jsonb);
SELECT r4_aplicar_extraccion(jsonb_build_object('id', (SELECT id FROM mensajes WHERE external_id='t-5'),
  'extraccion', '{"es_cliente":true,"nombre":"Joan","empresa":"CP Neptú 12","tipo_cliente":"comunidad","direccion_obra":"C/ Neptú 12","municipio":"s''Arenal","resumen":"Fachada"}'::jsonb))->>'inmueble_id' IS NOT NULL AS inmueble_creado;
SELECT r4_api(jsonb_build_object('op','update_inmueble','id',(SELECT id FROM inmuebles WHERE direccion='C/ Neptú 12'),'anio_construccion','1968','iee_fecha','basura'))->>'ok' AS upd_inmueble;
SELECT r4_summary()->'inmuebles'->0->>'alerta_iee' AS alerta, (r4_summary()->'kpis'->>'alertas_iee')::int AS n_alertas;
SELECT r4_alerta_iee(1990, current_date - 3650) AS renovar, r4_alerta_iee(2010, NULL) AS ok_reciente, r4_alerta_iee(NULL, NULL) AS sin_datos;
SELECT r4_api(jsonb_build_object('op','set_etapa','id',(SELECT max(id) FROM oportunidades),'etapa','perdido','motivo','Precio'))->>'ok' AS perdido;
SELECT motivo_perdida AS motivo FROM oportunidades WHERE id = (SELECT max(id) FROM oportunidades);
ROLLBACK;
