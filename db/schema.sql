-- =====================================================================
-- R4 · Esquema PostgreSQL v1  (base de datos: r4 · host interno r4_postgres)
-- Idempotente: se puede ejecutar varias veces sin perder datos.
-- Toda la lógica de negocio de ingesta vive aquí (funciones r4_*), para que
-- los flujos de n8n solo llamen a  SELECT r4_xxx(<param 1>::jsonb) AS r
-- Reglas: NUNCA escribir dólar+número en este archivo (ni en comentarios): n8n lo
--         ejecuta con pg-promise y lo tomaría como parámetro. Usar parámetros con
--         nombre y etiquetas de función tipo dólar-fn-dólar.
-- =====================================================================

CREATE TABLE IF NOT EXISTS r4_config (
  clave        text PRIMARY KEY,
  valor        text NOT NULL DEFAULT '',
  descripcion  text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO r4_config (clave, valor, descripcion) VALUES
  ('evolution_url',        '', 'URL base de Evolution API, sin barra final (https://evo.midominio.com)'),
  ('evolution_instancia',  '', 'Nombre de la instancia de Evolution API del agente ATLASR4'),
  ('wa_destino_direccion', '', 'Número(s) de WhatsApp que reciben los avisos de ECO. Formato 34XXXXXXXXX, separados por coma'),
  ('wa_campos',            'nombre,empresa,email,telefono,servicio,urgencia,direccion_obra,resumen', 'Campos extraídos que se envían por WhatsApp, en orden'),
  ('eco_activo',           'true', 'true/false · si ECO envía avisos por WhatsApp'),
  ('gmail_cuenta',         '', 'Cuenta Gmail que lee ECO (solo informativo)'),
  ('plataforma_url',       '', 'URL pública de la plataforma (Vercel) para el enlace «Ficha» del aviso')
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE IF NOT EXISTS clientes (
  id          bigserial PRIMARY KEY,
  nombre      text,
  empresa     text,
  email       text,
  telefono    text,
  tipo        text,            -- comunidad | administrador | particular | empresa | hotel | arquitecto | constructora | otro
  origen      text,            -- gmail | whatsapp | web | manual
  notas       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- RGPD: base legal de cada contacto (Propuesta R4 · módulo CRM)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS base_legal text NOT NULL DEFAULT 'medidas_precontractuales';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cargo text;
CREATE INDEX IF NOT EXISTS clientes_email_idx ON clientes (lower(email));
CREATE INDEX IF NOT EXISTS clientes_tel_idx   ON clientes (telefono);

CREATE TABLE IF NOT EXISTS oportunidades (
  id              bigserial PRIMARY KEY,
  cliente_id      bigint REFERENCES clientes(id),
  titulo          text NOT NULL,
  etapa           text NOT NULL DEFAULT 'nuevo'
                  CHECK (etapa IN ('nuevo','contactado','visita','presupuesto','aceptado','perdido')),
  servicio        text,
  urgencia        text,
  canal           text,
  direccion_obra  text,
  municipio       text,
  importe         numeric(12,2),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oportunidades_cliente_idx ON oportunidades (cliente_id);

-- CRM según la Propuesta de desarrollo (Organización e Inmueble; migración 002)
CREATE TABLE IF NOT EXISTS organizaciones (
  id          bigserial PRIMARY KEY,
  nombre      text NOT NULL,
  tipo        text,            -- comunidad | administrador_fincas | promotora | constructora | arquitecto_ingenieria | hotel | empresa | administracion_publica | proveedor | otro
  cif         text,
  datos_fiscales jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organizaciones_nombre_uq ON organizaciones (lower(nombre));
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS organizacion_id bigint REFERENCES organizaciones(id);

CREATE TABLE IF NOT EXISTS inmuebles (
  id                bigserial PRIMARY KEY,
  organizacion_id   bigint REFERENCES organizaciones(id),
  direccion         text NOT NULL,
  municipio         text NOT NULL DEFAULT '',
  anio_construccion int,
  tipo_estructura   text,
  iee_fecha         date,
  notas             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS inmuebles_dir_uq ON inmuebles (lower(direccion), lower(municipio));
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS inmueble_id bigint REFERENCES inmuebles(id);
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS motivo_perdida text;

-- Alerta IEE (Propuesta · CRM): edificio de más de 50 años sin IEE, o IEE a punto de cumplir 10 años
CREATE OR REPLACE FUNCTION r4_alerta_iee(anio int, iee date) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    WHEN anio IS NULL AND iee IS NULL THEN 'sin_datos'
    WHEN iee IS NULL AND anio <= extract(year FROM current_date)::int - 50 THEN 'sin_iee'
    WHEN iee IS NOT NULL AND iee <= (current_date - interval '9 years 6 months')::date THEN 'renovar'
    ELSE 'ok' END
$fn$;

CREATE TABLE IF NOT EXISTS mensajes (
  id                bigserial PRIMARY KEY,
  canal             text NOT NULL CHECK (canal IN ('gmail','whatsapp','web')),
  external_id       text NOT NULL,
  thread_id         text,
  remitente_nombre  text,
  remitente_email   text,
  remitente_tel     text,
  asunto            text,
  cuerpo            text,
  adjuntos          int NOT NULL DEFAULT 0,
  recibido_at       timestamptz NOT NULL DEFAULT now(),
  estado            text NOT NULL DEFAULT 'recibido',  -- recibido | procesado | ignorado | enviado_wa | error_wa
  es_cliente        boolean,
  extraccion        jsonb,
  cliente_id        bigint REFERENCES clientes(id),
  oportunidad_id    bigint REFERENCES oportunidades(id),
  wa_enviado_at     timestamptz,
  wa_error          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canal, external_id)
);
CREATE INDEX IF NOT EXISTS mensajes_recibido_idx ON mensajes (recibido_at DESC);

CREATE TABLE IF NOT EXISTS eventos (
  id          bigserial PRIMARY KEY,
  agente      text NOT NULL,          -- ATLAS | ECO | DIRECCION | SISTEMA ...
  nivel       text NOT NULL DEFAULT 'info',   -- info | warn | crit
  texto       text NOT NULL,
  ref         text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventos_created_idx ON eventos (created_at DESC);

-- ---------------------------------------------------------------------
-- Configuración como objeto JSON
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION r4_cfg() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT coalesce(jsonb_object_agg(clave, valor), '{}'::jsonb) FROM r4_config
$fn$;

-- ---------------------------------------------------------------------
-- 1) Registrar un mensaje entrante (Gmail / WhatsApp). Idempotente.
--    Devuelve {nuevo:true,id,msg} o {nuevo:false} si ya estaba registrado.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION r4_ingest(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_id bigint;
  v_fecha timestamptz;
BEGIN
  BEGIN
    v_fecha := coalesce(nullif(p->>'recibido_at','')::timestamptz, now());
  EXCEPTION WHEN others THEN
    v_fecha := now();
  END;

  INSERT INTO mensajes (canal, external_id, thread_id, remitente_nombre, remitente_email,
                        remitente_tel, asunto, cuerpo, adjuntos, recibido_at)
  VALUES (coalesce(nullif(p->>'canal',''), 'gmail'),
          p->>'external_id',
          nullif(p->>'thread_id',''),
          nullif(p->>'remitente_nombre',''),
          lower(nullif(trim(p->>'remitente_email'),'')),
          nullif(regexp_replace(coalesce(p->>'remitente_tel',''), '[^0-9+]', '', 'g'), ''),
          left(p->>'asunto', 500),
          left(p->>'cuerpo', 20000),
          coalesce(nullif(p->>'adjuntos','')::int, 0),
          v_fecha)
  ON CONFLICT (canal, external_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('nuevo', false);
  END IF;
  RETURN jsonb_build_object('nuevo', true, 'id', v_id, 'msg', p);
END
$fn$;

-- ---------------------------------------------------------------------
-- 2) Aplicar la extracción de ECO a un mensaje.
--    p = {id, extraccion:{es_cliente, nombre, empresa, email, telefono, tipo_cliente,
--         servicio, urgencia, solicita, direccion_obra, municipio, titulo, resumen, motivo}}
--    Crea/actualiza cliente (dedupe por email y teléfono), abre oportunidad,
--    registra evento y devuelve la config de WhatsApp para el aviso.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION r4_aplicar_extraccion(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_msg_id bigint := (p->>'id')::bigint;
  x        jsonb  := coalesce(p->'extraccion', '{}'::jsonb);
  m        mensajes%ROWTYPE;
  cfg      jsonb  := r4_cfg();
  v_cli    bigint;
  v_op     bigint;
  v_email  text;
  v_tel    text;
  v_nombre text;
  v_org    bigint;
  v_org_nombre text;
  v_inm    bigint;
BEGIN
  SELECT * INTO m FROM mensajes WHERE id = v_msg_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'mensaje no encontrado');
  END IF;

  IF coalesce((x->>'es_cliente')::boolean, false) = false THEN
    UPDATE mensajes SET es_cliente = false, extraccion = x, estado = 'ignorado' WHERE id = v_msg_id;
    INSERT INTO eventos (agente, texto, ref)
    VALUES ('ECO', 'Correo ignorado (no es cliente): ' || coalesce(m.asunto, '(sin asunto)'), 'mensaje:' || v_msg_id);
    RETURN jsonb_build_object('ok', true, 'es_cliente', false, 'id', v_msg_id);
  END IF;

  v_email := lower(nullif(trim(coalesce(nullif(x->>'email',''), m.remitente_email, '')), ''));
  IF v_email IS NOT NULL AND position('@' IN v_email) = 0 THEN v_email := NULL; END IF;
  v_tel := nullif(regexp_replace(coalesce(nullif(x->>'telefono',''), m.remitente_tel, ''), '[^0-9+]', '', 'g'), '');
  IF v_tel IS NOT NULL AND length(regexp_replace(v_tel, '[^0-9]', '', 'g')) < 9 THEN v_tel := NULL; END IF;
  v_nombre := nullif(trim(coalesce(nullif(x->>'nombre',''), m.remitente_nombre, '')), '');

  IF v_email IS NOT NULL THEN
    SELECT id INTO v_cli FROM clientes WHERE lower(email) = v_email ORDER BY id LIMIT 1;
  END IF;
  IF v_cli IS NULL AND v_tel IS NOT NULL THEN
    SELECT id INTO v_cli FROM clientes WHERE telefono = v_tel ORDER BY id LIMIT 1;
  END IF;

  IF v_cli IS NULL THEN
    INSERT INTO clientes (nombre, empresa, email, telefono, tipo, origen)
    VALUES (v_nombre, nullif(x->>'empresa',''), v_email, v_tel, nullif(x->>'tipo_cliente',''), m.canal)
    RETURNING id INTO v_cli;
  ELSE
    UPDATE clientes SET
      nombre     = coalesce(clientes.nombre, v_nombre),
      empresa    = coalesce(clientes.empresa, nullif(x->>'empresa','')),
      email      = coalesce(clientes.email, v_email),
      telefono   = coalesce(clientes.telefono, v_tel),
      tipo       = coalesce(clientes.tipo, nullif(x->>'tipo_cliente','')),
      updated_at = now()
    WHERE id = v_cli;
  END IF;

  -- Organización (no para particulares) e inmueble, según la Propuesta
  v_org_nombre := nullif(trim(coalesce(x->>'empresa','')), '');
  IF v_org_nombre IS NOT NULL AND lower(v_org_nombre) NOT IN ('particular','no indicado','desconocido') THEN
    INSERT INTO organizaciones (nombre, tipo) VALUES (v_org_nombre, nullif(x->>'tipo_cliente',''))
    ON CONFLICT (lower(nombre)) DO UPDATE SET updated_at = now()
    RETURNING id INTO v_org;
    UPDATE clientes SET organizacion_id = coalesce(organizacion_id, v_org) WHERE id = v_cli;
  END IF;
  IF nullif(trim(coalesce(x->>'direccion_obra','')), '') IS NOT NULL THEN
    INSERT INTO inmuebles (direccion, municipio, organizacion_id)
    VALUES (trim(x->>'direccion_obra'), coalesce(trim(x->>'municipio'), ''), v_org)
    ON CONFLICT (lower(direccion), lower(municipio)) DO UPDATE
      SET organizacion_id = coalesce(inmuebles.organizacion_id, EXCLUDED.organizacion_id), updated_at = now()
    RETURNING id INTO v_inm;
  END IF;

  SELECT id INTO v_op FROM oportunidades
   WHERE cliente_id = v_cli AND etapa NOT IN ('aceptado','perdido')
     AND created_at > now() - interval '30 days'
   ORDER BY created_at DESC LIMIT 1;

  IF v_op IS NULL THEN
    INSERT INTO oportunidades (cliente_id, inmueble_id, titulo, servicio, urgencia, canal, direccion_obra, municipio)
    VALUES (v_cli, v_inm,
            left(coalesce(nullif(x->>'titulo',''), m.asunto, 'Solicitud de cliente'), 140),
            nullif(x->>'servicio',''), nullif(x->>'urgencia',''), m.canal,
            nullif(x->>'direccion_obra',''), nullif(x->>'municipio',''))
    RETURNING id INTO v_op;
  ELSE
    UPDATE oportunidades SET inmueble_id = coalesce(inmueble_id, v_inm), updated_at = now() WHERE id = v_op;
  END IF;

  x := x || jsonb_build_object('email', coalesce(v_email, ''), 'telefono', coalesce(v_tel, ''), 'nombre', coalesce(v_nombre, ''));
  UPDATE mensajes SET es_cliente = true, extraccion = x, cliente_id = v_cli,
                      oportunidad_id = v_op, estado = 'procesado'
   WHERE id = v_msg_id;

  INSERT INTO eventos (agente, nivel, texto, ref)
  VALUES ('ECO', CASE WHEN x->>'urgencia' = 'alta' THEN 'warn' ELSE 'info' END,
          'Cliente ' || coalesce(v_nombre, v_email, 'sin nombre') || ': ' || left(coalesce(x->>'resumen',''), 220),
          'mensaje:' || v_msg_id);

  RETURN jsonb_build_object(
    'ok', true, 'es_cliente', true, 'id', v_msg_id, 'canal', m.canal,
    'cliente_id', v_cli, 'oportunidad_id', v_op, 'organizacion_id', v_org, 'inmueble_id', v_inm, 'asunto', m.asunto,
    'extraccion', x,
    'wa', jsonb_build_object(
      'url',       cfg->>'evolution_url',
      'instancia', cfg->>'evolution_instancia',
      'destino',   cfg->>'wa_destino_direccion',
      'campos',    cfg->>'wa_campos',
      'ficha',     CASE WHEN coalesce(cfg->>'plataforma_url','') <> '' THEN rtrim(cfg->>'plataforma_url','/') || '/#bandeja' ELSE '' END,
      'activo',    coalesce(cfg->>'eco_activo', 'true') = 'true'
                   AND coalesce(cfg->>'evolution_url','') <> ''
                   AND coalesce(cfg->>'evolution_instancia','') <> ''
                   AND coalesce(cfg->>'wa_destino_direccion','') <> ''));
END
$fn$;

-- ---------------------------------------------------------------------
-- 3) Resultado del envío por WhatsApp.  p = {id, ok, detalle}
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION r4_marcar_wa(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_id bigint  := (p->>'id')::bigint;
  v_ok boolean := coalesce((p->>'ok')::boolean, false);
BEGIN
  UPDATE mensajes SET
    wa_enviado_at = CASE WHEN v_ok THEN now() ELSE wa_enviado_at END,
    wa_error      = CASE WHEN v_ok THEN NULL ELSE left(coalesce(p->>'detalle',''), 500) END,
    estado        = CASE WHEN v_ok THEN 'enviado_wa' ELSE 'error_wa' END
  WHERE id = v_id;
  INSERT INTO eventos (agente, nivel, texto, ref)
  VALUES ('ECO', CASE WHEN v_ok THEN 'info' ELSE 'warn' END,
          CASE WHEN v_ok THEN 'Datos del cliente enviados al WhatsApp de Dirección.'
               ELSE 'No se pudo enviar el aviso por WhatsApp: ' || left(coalesce(p->>'detalle',''), 200) END,
          'mensaje:' || v_id);
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'enviado', v_ok);
END
$fn$;

-- ---------------------------------------------------------------------
-- 4) Resumen para la plataforma (Mission Control, Bandeja, CRM, Configuración)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION r4_summary() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  WITH hoy AS (SELECT (date_trunc('day', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid') AS t0)
  SELECT jsonb_build_object(
    'generado_at', now(),
    'kpis', jsonb_build_object(
      'mensajes_hoy',           (SELECT count(*) FROM mensajes, hoy WHERE recibido_at >= hoy.t0),
      'clientes_hoy',           (SELECT count(*) FROM mensajes, hoy WHERE recibido_at >= hoy.t0 AND es_cliente),
      'ignorados_hoy',          (SELECT count(*) FROM mensajes, hoy WHERE recibido_at >= hoy.t0 AND es_cliente = false),
      'wa_hoy',                 (SELECT count(*) FROM mensajes, hoy WHERE wa_enviado_at >= hoy.t0),
      'errores_wa',             (SELECT count(*) FROM mensajes WHERE estado = 'error_wa'),
      'clientes_total',         (SELECT count(*) FROM clientes),
      'clientes_7d',            (SELECT count(*) FROM clientes WHERE created_at > now() - interval '7 days'),
      'oportunidades_abiertas', (SELECT count(*) FROM oportunidades WHERE etapa NOT IN ('aceptado','perdido')),
      'organizaciones',         (SELECT count(*) FROM organizaciones),
      'alertas_iee',            (SELECT count(*) FROM inmuebles WHERE r4_alerta_iee(anio_construccion, iee_fecha) IN ('sin_iee','renovar'))
    ),
    'mensajes', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.recibido_at DESC), '[]'::jsonb) FROM (
        SELECT id, canal, asunto, left(cuerpo, 400) AS preview, remitente_nombre, remitente_email,
               remitente_tel, recibido_at, estado, es_cliente, extraccion, wa_enviado_at, wa_error,
               cliente_id, oportunidad_id
          FROM mensajes ORDER BY recibido_at DESC LIMIT 60) t),
    'oportunidades', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb) FROM (
        SELECT o.id, o.cliente_id, o.titulo, o.etapa, o.servicio, o.urgencia, o.canal, o.importe, o.municipio,
               o.direccion_obra, o.motivo_perdida, o.inmueble_id, o.created_at, c.nombre AS cliente_nombre,
               coalesce(g.nombre, c.empresa) AS cliente_empresa, g.tipo AS organizacion_tipo,
               c.email AS cliente_email, c.telefono AS cliente_tel
          FROM oportunidades o LEFT JOIN clientes c ON c.id = o.cliente_id
          LEFT JOIN organizaciones g ON g.id = c.organizacion_id
         ORDER BY o.created_at DESC LIMIT 200) t),
    'clientes', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb) FROM (
        SELECT c.id, c.nombre, c.email, c.telefono, c.tipo, c.origen, c.base_legal, c.cargo, c.created_at,
               coalesce(g.nombre, c.empresa) AS empresa, g.tipo AS organizacion_tipo
          FROM clientes c LEFT JOIN organizaciones g ON g.id = c.organizacion_id
         ORDER BY c.created_at DESC LIMIT 300) t),
    'inmuebles', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb) FROM (
        SELECT i.id, i.direccion, i.municipio, i.anio_construccion, i.tipo_estructura, i.iee_fecha, i.created_at,
               g.nombre AS organizacion, r4_alerta_iee(i.anio_construccion, i.iee_fecha) AS alerta_iee,
               (SELECT count(*) FROM oportunidades o WHERE o.inmueble_id = i.id) AS oportunidades
          FROM inmuebles i LEFT JOIN organizaciones g ON g.id = i.organizacion_id
         ORDER BY i.created_at DESC LIMIT 100) t),
    'eventos', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb) FROM (
        SELECT id, agente, nivel, texto, ref, created_at FROM eventos ORDER BY created_at DESC LIMIT 30) t),
    'canales', jsonb_build_object(
      'ultimo_gmail',       (SELECT max(recibido_at) FROM mensajes WHERE canal = 'gmail'),
      'ultimo_whatsapp',    (SELECT max(recibido_at) FROM mensajes WHERE canal = 'whatsapp'),
      'ultimo_aviso_wa',    (SELECT max(wa_enviado_at) FROM mensajes)
    ),
    'config', r4_cfg()
  )
$fn$;

-- ---------------------------------------------------------------------
-- 5) Puerta de la API (llamada por el flujo "R4 · API" desde la plataforma)
--    p = {op: summary | set_config | update_extraccion | set_etapa | update_inmueble | reenviar_wa | marcar_cliente | marcar_ignorado, ...}
--    Si la respuesta lleva enviar_wa=true, n8n envía el WhatsApp y llama a r4_marcar_wa.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION r4_api(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_op   text   := coalesce(p->>'op', 'summary');
  v_id   bigint := nullif(p->>'id','')::bigint;
  k      text;
  v      text;
  m      mensajes%ROWTYPE;
  res    jsonb;
  permitidas text[] := ARRAY['evolution_url','evolution_instancia','wa_destino_direccion','wa_campos','eco_activo','gmail_cuenta','plataforma_url'];
BEGIN
  IF v_op = 'summary' THEN
    RETURN jsonb_build_object('ok', true, 'data', r4_summary());

  ELSIF v_op = 'set_config' THEN
    FOR k, v IN SELECT * FROM jsonb_each_text(coalesce(p->'config', '{}'::jsonb)) LOOP
      IF k = ANY (permitidas) THEN
        INSERT INTO r4_config (clave, valor) VALUES (k, left(trim(coalesce(v,'')), 500))
        ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();
      END IF;
    END LOOP;
    INSERT INTO eventos (agente, texto) VALUES ('DIRECCION', 'Configuración de integraciones actualizada desde la plataforma.');
    RETURN jsonb_build_object('ok', true, 'config', r4_cfg());

  ELSIF v_op = 'update_extraccion' THEN
    UPDATE mensajes SET extraccion = coalesce(extraccion, '{}'::jsonb) || coalesce(p->'extraccion', '{}'::jsonb)
     WHERE id = v_id RETURNING * INTO m;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'mensaje no encontrado'); END IF;
    IF m.cliente_id IS NOT NULL THEN
      UPDATE clientes SET
        nombre   = coalesce(nullif(p->'extraccion'->>'nombre',''), nombre),
        empresa  = coalesce(nullif(p->'extraccion'->>'empresa',''), empresa),
        email    = coalesce(lower(nullif(p->'extraccion'->>'email','')), email),
        telefono = coalesce(nullif(regexp_replace(coalesce(p->'extraccion'->>'telefono',''), '[^0-9+]', '', 'g'),''), telefono),
        updated_at = now()
      WHERE id = m.cliente_id;
    END IF;
    INSERT INTO eventos (agente, texto, ref) VALUES ('DIRECCION', 'Datos corregidos a mano en el mensaje #' || v_id || '.', 'mensaje:' || v_id);
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  ELSIF v_op = 'set_etapa' THEN
    UPDATE oportunidades SET etapa = p->>'etapa',
           motivo_perdida = CASE WHEN p->>'etapa' = 'perdido' THEN nullif(left(trim(coalesce(p->>'motivo','')), 300), '') ELSE NULL END,
           updated_at = now() WHERE id = v_id;
    INSERT INTO eventos (agente, texto, ref) VALUES ('DIRECCION', 'Oportunidad #' || v_id || ' movida a «' || (p->>'etapa') || '»'
           || CASE WHEN p->>'etapa' = 'perdido' AND coalesce(p->>'motivo','') <> '' THEN ' · motivo: ' || left(p->>'motivo', 120) ELSE '' END || '.', 'oportunidad:' || v_id);
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  ELSIF v_op = 'update_inmueble' THEN
    UPDATE inmuebles SET
      anio_construccion = CASE WHEN coalesce(p->>'anio_construccion','') ~ '^[0-9]{4}$' THEN (p->>'anio_construccion')::int ELSE anio_construccion END,
      tipo_estructura   = coalesce(nullif(left(trim(coalesce(p->>'tipo_estructura','')), 120), ''), tipo_estructura),
      iee_fecha         = CASE WHEN coalesce(p->>'iee_fecha','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (p->>'iee_fecha')::date ELSE iee_fecha END,
      updated_at        = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'inmueble no encontrado'); END IF;
    INSERT INTO eventos (agente, texto, ref) VALUES ('DIRECCION', 'Datos del inmueble #' || v_id || ' actualizados (año, estructura o IEE).', 'inmueble:' || v_id);
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  ELSIF v_op = 'marcar_ignorado' THEN
    UPDATE mensajes SET es_cliente = false, estado = 'ignorado' WHERE id = v_id;
    INSERT INTO eventos (agente, texto, ref) VALUES ('DIRECCION', 'Mensaje #' || v_id || ' marcado como no cliente.', 'mensaje:' || v_id);
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  ELSIF v_op IN ('reenviar_wa', 'marcar_cliente') THEN
    SELECT * INTO m FROM mensajes WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'mensaje no encontrado'); END IF;
    res := r4_aplicar_extraccion(jsonb_build_object(
             'id', v_id,
             'extraccion', coalesce(m.extraccion, '{}'::jsonb)
                           || jsonb_build_object('es_cliente', true)
                           || coalesce(p->'extraccion', '{}'::jsonb)));
    RETURN res || jsonb_build_object('enviar_wa', coalesce((res->'wa'->>'activo')::boolean, false));

  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'operación desconocida: ' || v_op);
END
$fn$;

INSERT INTO eventos (agente, texto) VALUES ('SISTEMA', 'Esquema R4 v1 instalado o actualizado.');

SELECT jsonb_build_object('ok', true, 'tablas', (SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('r4_config','clientes','organizaciones','inmuebles','oportunidades','mensajes','eventos'))) AS r;
