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
-- 4b) Usuarios con cuenta de Google · Dirección aprueba y asigna rol
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  email          text PRIMARY KEY,
  nombre         text,
  foto           text,
  rol            text NOT NULL DEFAULT 'pendiente'
                 CHECK (rol IN ('direccion','tecnico','comercial','administracion','encargado','colaborador','cliente','pendiente')),
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','activo','bloqueado')),
  solicitud      text,            -- por dónde pidió acceso: direccion | equipo | cliente
  cliente_id     bigint,          -- solo rol cliente: ficha del CRM que puede ver
  aprobado_por   text,
  aprobado_at    timestamptz,
  ultimo_acceso  timestamptz,
  accesos        int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- v1.5: roles encargado y cliente, solicitud y ficha de cliente (migración idempotente)
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS solicitud text;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cliente_id bigint;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('direccion','tecnico','comercial','administracion','encargado','colaborador','cliente','pendiente'));
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_cliente_fk;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_cliente_fk FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL;

-- Llamada solo desde Vercel (callback de Google). p = {email, nombre, foto, direccion:boolean, solicitud}
CREATE OR REPLACE FUNCTION r4_auth_login(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_email text    := lower(trim(coalesce(p->>'email', '')));
  v_dir   boolean := coalesce((p->>'direccion')::boolean, false);
  u       usuarios%ROWTYPE;
BEGIN
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email no válido');
  END IF;
  SELECT * INTO u FROM usuarios WHERE email = v_email;
  IF NOT FOUND THEN
    -- Tope anti-spam: cualquiera con cuenta de Google puede pedir acceso
    IF NOT v_dir AND (SELECT count(*) FROM usuarios WHERE estado = 'pendiente') >= 50 THEN
      RETURN jsonb_build_object('ok', true, 'email', v_email, 'nombre', NULL, 'rol', 'pendiente', 'estado', 'pendiente');
    END IF;
    INSERT INTO usuarios (email, nombre, foto, rol, estado, aprobado_por, aprobado_at, solicitud)
    VALUES (v_email, nullif(left(regexp_replace(coalesce(p->>'nombre',''), '[[:cntrl:]]', '', 'g'), 80),''), nullif(left(p->>'foto', 500),''),
            CASE WHEN v_dir THEN 'direccion' ELSE 'pendiente' END,
            CASE WHEN v_dir THEN 'activo' ELSE 'pendiente' END,
            CASE WHEN v_dir THEN 'sistema' END, CASE WHEN v_dir THEN now() END,
            CASE WHEN v_dir THEN 'direccion' WHEN p->>'solicitud' = 'cliente' THEN 'cliente' ELSE 'equipo' END)
    RETURNING * INTO u;
    INSERT INTO eventos (agente, nivel, texto, ref)
    VALUES ('SISTEMA', CASE WHEN v_dir THEN 'info' ELSE 'warn' END,
            CASE WHEN v_dir THEN 'Acceso de Dirección registrado: ' || v_email
                 ELSE 'Solicitud de acceso ' || CASE WHEN u.solicitud = 'cliente' THEN 'de cliente' ELSE 'de equipo' END
                      || ' con Google pendiente de aprobar: ' || coalesce(u.nombre, v_email) || ' (' || v_email || ')' END,
            'usuario:' || v_email);
  ELSIF v_dir AND (u.rol <> 'direccion' OR u.estado <> 'activo') THEN
    UPDATE usuarios SET rol = 'direccion', estado = 'activo', updated_at = now() WHERE email = v_email RETURNING * INTO u;
  END IF;
  IF u.estado = 'activo' THEN
    UPDATE usuarios SET ultimo_acceso = now(), accesos = accesos + 1,
           nombre = coalesce(nullif(left(regexp_replace(coalesce(p->>'nombre',''), '[[:cntrl:]]', '', 'g'), 80),''), nombre),
           foto = coalesce(nullif(left(p->>'foto', 500),''), foto), updated_at = now()
     WHERE email = v_email RETURNING * INTO u;
    INSERT INTO eventos (agente, texto, ref) VALUES ('SISTEMA', 'Inicio de sesión con Google: ' || coalesce(u.nombre, v_email) || ' · ' || u.rol, 'usuario:' || v_email);
  END IF;
  RETURN jsonb_build_object('ok', true, 'email', u.email, 'nombre', u.nombre, 'rol', u.rol, 'estado', u.estado);
END
$fn$;

-- ---------------------------------------------------------------------
-- 4c) Gestión operativa v1.5 (notas de voz del 24 nov · docs/NOTAS_VOZ_2026-11-24.md)
--     Obras con código, cuadrilla, mods/extensiones y partes de personal · costes
--     directos e indirectos · almacén · certificaciones · presupuestos estándar.
-- ---------------------------------------------------------------------
INSERT INTO r4_config (clave, valor, descripcion) VALUES
  ('objetivo_beneficio',    '20', 'Beneficio real objetivo (%) después de costes indirectos'),
  ('umbral_ci',             '15', '% de coste indirecto sobre ventas a partir del cual se avisa (punto de equilibrio)'),
  ('coste_jornada_oficial', '',   'Coste empresa por jornada de oficial si el operario no tiene nómina cargada (€)'),
  ('coste_jornada_peon',    '',   'Coste empresa por jornada de peón si el operario no tiene nómina cargada (€)'),
  ('dias_nomina',           '21', 'Días laborables al mes para pasar la nómina mensual a coste por jornada'),
  ('correo_materiales',     '',   'Correo exclusivo para facturas de materiales (con código de obra)'),
  ('ventas_anuales_ref',    '',   'Facturación anual de referencia (€) para el % de coste indirecto; vacío = lo certificado en 12 meses')
ON CONFLICT (clave) DO NOTHING;

-- Número de la configuración en formato español o normal (1.150.000 · 150,5 · 20)
CREATE OR REPLACE FUNCTION r4_cfg_num(k text) RETURNS numeric LANGUAGE sql STABLE AS $fn$
  SELECT CASE WHEN v ~ '^[0-9]{1,3}([.][0-9]{3})+(,[0-9]+)?$' THEN replace(replace(v, '.', ''), ',', '.')::numeric
              WHEN v ~ '^[0-9]+([.,][0-9]+)?$' THEN replace(v, ',', '.')::numeric END
    FROM (SELECT regexp_replace(coalesce((SELECT valor FROM r4_config WHERE clave = k), ''), '[[:space:]€]', '', 'g') AS v) x
$fn$;

-- Quién puede hacer qué (se comprueba en cada petición)
CREATE OR REPLACE FUNCTION r4_puede(rol text, accion text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT coalesce(CASE accion
    WHEN 'crm'              THEN rol IN ('direccion','tecnico','comercial','administracion')
    WHEN 'ver_obras'        THEN rol IN ('direccion','tecnico','comercial','administracion','encargado','colaborador')
    WHEN 'obras'            THEN rol IN ('direccion','tecnico','administracion')
    WHEN 'partes'           THEN rol IN ('direccion','tecnico','administracion','encargado')
    WHEN 'costes_obra'      THEN rol IN ('direccion','tecnico','administracion','encargado')
    WHEN 'costes'           THEN rol IN ('direccion','administracion')
    WHEN 'personal'         THEN rol IN ('direccion','administracion')
    WHEN 'almacen'          THEN rol IN ('direccion','tecnico','administracion','encargado')
    WHEN 'ver_presupuestos' THEN rol IN ('direccion','tecnico','comercial','administracion')
    WHEN 'presupuestos'     THEN rol IN ('direccion','tecnico','comercial')
    WHEN 'precios'          THEN rol IN ('direccion','tecnico')
    WHEN 'certificar'       THEN rol IN ('direccion','tecnico','administracion')
    WHEN 'aprobar'          THEN rol = 'direccion'
    WHEN 'facturar'         THEN rol = 'direccion'
    WHEN 'config'           THEN rol = 'direccion'
    WHEN 'accesos'          THEN rol = 'direccion'
  END, false)
$fn$;

CREATE OR REPLACE FUNCTION r4_permisos(rol text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $fn$
  SELECT jsonb_object_agg(a, r4_puede(rol, a)) FROM unnest(ARRAY['crm','ver_obras','obras','partes','costes_obra','costes','personal',
    'almacen','ver_presupuestos','presupuestos','precios','certificar','aprobar','facturar','config','accesos']) a
$fn$;

-- Fecha en la que acaba un trabajo de n días laborables que empieza el día d (lunes a viernes)
CREATE OR REPLACE FUNCTION r4_laborables(d date, n numeric) RETURNS date LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  x date := d;
  k int := 1;
  total int := greatest(ceil(coalesce(n, 0))::int, 1);
BEGIN
  IF d IS NULL THEN RETURN NULL; END IF;
  WHILE extract(isodow FROM x) > 5 LOOP x := x + 1; END LOOP;
  WHILE k < total LOOP
    x := x + 1;
    IF extract(isodow FROM x) <= 5 THEN k := k + 1; END IF;
  END LOOP;
  RETURN x;
END
$fn$;

CREATE TABLE IF NOT EXISTS operarios (
  id             bigserial PRIMARY KEY,
  nombre         text NOT NULL,
  categoria      text NOT NULL DEFAULT 'oficial' CHECK (categoria IN ('oficial','peon','encargado')),
  coste_mensual  numeric(10,2),          -- coste empresa de la nómina (bruto + Seguridad Social)
  telefono       text,
  activo         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS operarios_nombre_uq ON operarios (lower(nombre));

-- Coste de una jornada: nómina ÷ días, o la tarifa de referencia de su categoría
CREATE OR REPLACE FUNCTION r4_coste_jornada(coste_mensual numeric, categoria text) RETURNS numeric LANGUAGE sql STABLE AS $fn$
  SELECT round(coalesce(coste_mensual / nullif(r4_cfg_num('dias_nomina'), 0),
                        CASE WHEN categoria = 'peon' THEN r4_cfg_num('coste_jornada_peon') ELSE r4_cfg_num('coste_jornada_oficial') END, 0), 2)
$fn$;

CREATE TABLE IF NOT EXISTS obras (
  id              bigserial PRIMARY KEY,
  codigo          text NOT NULL,
  titulo          text NOT NULL,
  cliente_id      bigint REFERENCES clientes(id) ON DELETE SET NULL,
  oportunidad_id  bigint REFERENCES oportunidades(id) ON DELETE SET NULL,
  ubicacion       text,
  estado          text NOT NULL DEFAULT 'planificada' CHECK (estado IN ('planificada','en_curso','parada','terminada','facturada')),
  fecha_inicio    date,
  oficiales       int NOT NULL DEFAULT 2 CHECK (oficiales BETWEEN 0 AND 50),
  peones          int NOT NULL DEFAULT 1 CHECK (peones BETWEEN 0 AND 50),
  periodo_control text NOT NULL DEFAULT 'semanal' CHECK (periodo_control IN ('diario','semanal','quincenal')),
  presupuesto_url text,
  presupuesto_id  bigint,
  notas           text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS obras_codigo_uq ON obras (lower(codigo));

-- Presupuesto de la obra por líneas (0 = original, n = extensión n) y versiones (mod n). Manda la versión más alta.
CREATE TABLE IF NOT EXISTS obra_presupuestos (
  id          bigserial PRIMARY KEY,
  obra_id     bigint NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  linea       int NOT NULL DEFAULT 0 CHECK (linea >= 0),
  version     int NOT NULL DEFAULT 0 CHECK (version >= 0),
  importe     numeric(12,2) NOT NULL DEFAULT 0,
  jornadas    numeric(8,1) NOT NULL DEFAULT 0,     -- mano de obra presupuestada: operario × día
  material    numeric(12,2) NOT NULL DEFAULT 0,
  motivo      text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, linea, version)
);

-- Parte de personal: qué operarios fueron a qué obra cada día (lo pica secretaría o el encargado)
CREATE TABLE IF NOT EXISTS partes (
  id           bigserial PRIMARY KEY,
  obra_id      bigint NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  fecha        date NOT NULL,
  operario_id  bigint NOT NULL REFERENCES operarios(id),
  categoria    text NOT NULL DEFAULT 'oficial' CHECK (categoria IN ('oficial','peon','encargado')),
  jornadas     numeric(3,1) NOT NULL DEFAULT 1 CHECK (jornadas > 0 AND jornadas <= 1.5),
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, fecha, operario_id)
);
CREATE INDEX IF NOT EXISTS partes_fecha_idx ON partes (fecha DESC);

CREATE TABLE IF NOT EXISTS costes (
  id           bigserial PRIMARY KEY,
  tipo         text NOT NULL CHECK (tipo IN ('directo','indirecto')),
  categoria    text NOT NULL DEFAULT 'otros' CHECK (categoria IN ('material','gasolina','mano_obra','subcontrata','alquiler',
                 'nomina_estructura','seguro','prevencion','oficina','vehiculo','herramientas','otros')),
  obra_id      bigint REFERENCES obras(id) ON DELETE SET NULL,
  concepto     text NOT NULL,
  proveedor    text,
  importe      numeric(12,2) NOT NULL,
  fecha        date NOT NULL DEFAULT current_date,
  periodicidad text NOT NULL DEFAULT 'puntual' CHECK (periodicidad IN ('puntual','mensual','anual')),
  origen       text NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual','excel','pdf','foto','gmail','atlas','almacen')),
  documento    text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS costes_obra_idx ON costes (obra_id);
CREATE INDEX IF NOT EXISTS costes_fecha_idx ON costes (fecha DESC);

CREATE TABLE IF NOT EXISTS articulos (
  id              bigserial PRIMARY KEY,
  nombre          text NOT NULL,
  unidad          text NOT NULL DEFAULT 'ud',
  stock           numeric(12,2) NOT NULL DEFAULT 0,
  coste_unitario  numeric(10,2) NOT NULL DEFAULT 0,
  minimo          numeric(12,2) NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS articulos_nombre_uq ON articulos (lower(nombre));

CREATE TABLE IF NOT EXISTS movimientos (
  id              bigserial PRIMARY KEY,
  articulo_id     bigint NOT NULL REFERENCES articulos(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('entrada','salida')),
  cantidad        numeric(12,2) NOT NULL CHECK (cantidad > 0),
  obra_id         bigint REFERENCES obras(id) ON DELETE SET NULL,
  coste_unitario  numeric(10,2),
  fecha           date NOT NULL DEFAULT current_date,
  origen          text NOT NULL DEFAULT 'manual',
  nota            text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS certificaciones (
  id           bigserial PRIMARY KEY,
  obra_id      bigint NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero       int NOT NULL,
  tipo         text NOT NULL DEFAULT 'parcial' CHECK (tipo IN ('parcial','final')),
  fecha        date NOT NULL DEFAULT current_date,
  importe      numeric(12,2) NOT NULL CHECK (importe >= 0),
  estado       text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','enviada','conforme','facturada')),
  notas        text,
  conforme_por text,
  conforme_at  timestamptz,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, numero)
);

-- Catálogo de partidas estándar (precio NULL = pendiente de que R4 lo fije)
CREATE TABLE IF NOT EXISTS partidas (
  id            bigserial PRIMARY KEY,
  codigo        text NOT NULL,
  descripcion   text NOT NULL,
  unidad        text NOT NULL DEFAULT 'ud',
  precio        numeric(10,2),
  material_pct  numeric(5,2) NOT NULL DEFAULT 40 CHECK (material_pct BETWEEN 0 AND 100),
  jornadas_ud   numeric(8,3) NOT NULL DEFAULT 0 CHECK (jornadas_ud >= 0),
  familia       text,
  activo        boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS partidas_codigo_uq ON partidas (lower(codigo));
INSERT INTO partidas (codigo, descripcion, unidad, familia) VALUES
  ('MV-01', 'Mecanoviga · refuerzo de vigueta (por metro de vigueta)', 'ml', 'Mecanoviga'),
  ('AP-01', 'Apuntalamiento provisional de forjado', 'm²', 'Auxiliares'),
  ('VC-01', 'Reparación de viga castellana', 'ml', 'Hormigón armado'),
  ('HA-01', 'Reparación de hormigón armado (saneado, pasivado y mortero)', 'm²', 'Hormigón armado'),
  ('PI-01', 'Encamisado de pilar', 'ud', 'Refuerzo estructural'),
  ('AC-01', 'Tratamiento anticarbonatación y protección de fachada', 'm²', 'Protección'),
  ('HU-01', 'Inyección contra humedad por capilaridad', 'ml', 'Trabajos auxiliares')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS presupuestos (
  id              bigserial PRIMARY KEY,
  codigo          text NOT NULL,
  titulo          text NOT NULL,
  cliente_id      bigint REFERENCES clientes(id) ON DELETE SET NULL,
  oportunidad_id  bigint REFERENCES oportunidades(id) ON DELETE SET NULL,
  ubicacion       text,
  ajuste_pct      numeric(6,2) NOT NULL DEFAULT 0 CHECK (ajuste_pct BETWEEN -50 AND 200),
  estado          text NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','enviado','aceptado','rechazado')),
  obra_id         bigint REFERENCES obras(id) ON DELETE SET NULL,
  origen          text NOT NULL DEFAULT 'plataforma',
  notas           text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS presupuestos_codigo_uq ON presupuestos (lower(codigo));

CREATE TABLE IF NOT EXISTS presupuesto_lineas (
  id              bigserial PRIMARY KEY,
  presupuesto_id  bigint NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  orden           int NOT NULL DEFAULT 0,
  partida_id      bigint REFERENCES partidas(id) ON DELETE SET NULL,
  descripcion     text NOT NULL,
  unidad          text NOT NULL DEFAULT 'ud',
  cantidad        numeric(12,3) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  precio          numeric(10,2) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  material_pct    numeric(5,2) NOT NULL DEFAULT 0 CHECK (material_pct BETWEEN 0 AND 100),
  jornadas_ud     numeric(8,3) NOT NULL DEFAULT 0 CHECK (jornadas_ud >= 0)
);

-- Totales de un presupuesto: importe con ajuste, material, mano de obra (€) y jornadas
CREATE OR REPLACE FUNCTION r4_presupuesto_totales(pid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object(
    'subtotal', round(coalesce(sum(l.cantidad * l.precio), 0), 2),
    'total',    round(coalesce(sum(l.cantidad * l.precio), 0) * (1 + p.ajuste_pct / 100), 2),
    'material', round(coalesce(sum(l.cantidad * l.precio * l.material_pct / 100), 0) * (1 + p.ajuste_pct / 100), 2),
    'jornadas', round(coalesce(sum(l.cantidad * l.jornadas_ud), 0), 1),
    'sin_precio', count(*) FILTER (WHERE l.precio = 0))
  FROM presupuestos p LEFT JOIN presupuesto_lineas l ON l.presupuesto_id = p.id
  WHERE p.id = pid GROUP BY p.ajuste_pct
$fn$;

-- Obras con presupuesto vigente, avance, fecha de fin, control semanal y (si procede) costes y margen
CREATE OR REPLACE FUNCTION r4_obras_json(ver_costes boolean, solo_cliente bigint DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  WITH vig AS (
    SELECT DISTINCT ON (obra_id, linea) obra_id, linea, version, importe, jornadas, material, motivo
      FROM obra_presupuestos ORDER BY obra_id, linea, version DESC),
  tot AS (
    SELECT obra_id, sum(importe) AS importe, sum(jornadas) AS jornadas, sum(material) AS material,
           jsonb_agg(jsonb_build_object('linea', linea, 'version', version, 'importe', importe, 'jornadas', jornadas,
                     'material', material, 'motivo', motivo) ORDER BY linea) AS lineas
      FROM vig GROUP BY obra_id),
  par AS (
    SELECT p.obra_id, sum(p.jornadas) AS jornadas, max(p.fecha) AS ultimo,
           sum(p.jornadas * r4_coste_jornada(o.coste_mensual, p.categoria)) AS coste_mo
      FROM partes p JOIN operarios o ON o.id = p.operario_id GROUP BY p.obra_id),
  cos AS (
    SELECT obra_id, sum(importe) AS total,
           sum(importe) FILTER (WHERE categoria = 'material') AS material,
           sum(importe) FILTER (WHERE categoria = 'gasolina') AS gasolina
      FROM costes WHERE tipo = 'directo' AND obra_id IS NOT NULL GROUP BY obra_id),
  cer AS (
    SELECT obra_id,
           sum(importe) FILTER (WHERE estado IN ('conforme','facturada')) AS certificado,
           jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'tipo', tipo, 'fecha', fecha, 'importe', importe,
                     'estado', estado, 'notas', notas, 'conforme_por', conforme_por, 'conforme_at', conforme_at) ORDER BY numero) AS lista
      FROM certificaciones GROUP BY obra_id),
  base AS (
    SELECT o.*, c.nombre AS cliente_nombre, coalesce(g.nombre, c.empresa) AS cliente_empresa,
           coalesce(t.importe, 0) AS importe, coalesce(t.jornadas, 0) AS jornadas_presupuesto, coalesce(t.material, 0) AS material_presupuesto,
           coalesce(t.lineas, '[]'::jsonb) AS lineas,
           coalesce(pa.jornadas, 0) AS jornadas_registradas, pa.ultimo AS ultimo_parte, coalesce(pa.coste_mo, 0) AS coste_mo,
           coalesce(co.total, 0) AS coste_otros, coalesce(co.material, 0) AS coste_material, coalesce(co.gasolina, 0) AS coste_gasolina,
           coalesce(ce.certificado, 0) AS certificado, coalesce(ce.lista, '[]'::jsonb) AS certificaciones,
           greatest(1, o.oficiales + o.peones) AS cuadrilla
      FROM obras o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN organizaciones g ON g.id = c.organizacion_id
      LEFT JOIN tot t ON t.obra_id = o.id
      LEFT JOIN par pa ON pa.obra_id = o.id
      LEFT JOIN cos co ON co.obra_id = o.id
      LEFT JOIN cer ce ON ce.obra_id = o.id
     WHERE solo_cliente IS NULL OR o.cliente_id = solo_cliente)
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', b.id, 'codigo', b.codigo, 'titulo', b.titulo, 'cliente_id', b.cliente_id, 'cliente_nombre', b.cliente_nombre,
      'cliente_empresa', b.cliente_empresa, 'ubicacion', b.ubicacion, 'estado', b.estado, 'fecha_inicio', b.fecha_inicio,
      'oficiales', b.oficiales, 'peones', b.peones, 'periodo_control', b.periodo_control,
      'presupuesto_url', b.presupuesto_url, 'presupuesto_id', b.presupuesto_id, 'notas', b.notas,
      'importe', b.importe, 'jornadas_presupuesto', b.jornadas_presupuesto, 'material_presupuesto', b.material_presupuesto,
      'lineas', b.lineas, 'jornadas_registradas', b.jornadas_registradas, 'ultimo_parte', b.ultimo_parte,
      'avance', CASE WHEN b.jornadas_presupuesto > 0 THEN round(b.jornadas_registradas * 100 / b.jornadas_presupuesto, 1) ELSE 0 END,
      'dias_previstos', ceil(b.jornadas_presupuesto / b.cuadrilla),
      'fecha_fin', r4_laborables(b.fecha_inicio, b.jornadas_presupuesto / b.cuadrilla),
      'control_pendiente', b.estado = 'en_curso' AND (b.ultimo_parte IS NULL OR b.ultimo_parte <
                           current_date - CASE b.periodo_control WHEN 'diario' THEN 1 WHEN 'quincenal' THEN 14 ELSE 7 END),
      'certificado', b.certificado, 'certificaciones', b.certificaciones, 'created_at', b.created_at)
    || CASE WHEN ver_costes THEN jsonb_build_object(
      'coste_mo', round(b.coste_mo, 2), 'coste_material', b.coste_material, 'coste_gasolina', b.coste_gasolina,
      'coste_directo', round(b.coste_mo + b.coste_otros, 2),
      'margen_directo', CASE WHEN b.importe > 0 THEN round((b.importe - b.coste_mo - b.coste_otros) * 100 / b.importe, 1) END)
      ELSE '{}'::jsonb END
    ORDER BY (b.estado IN ('terminada','facturada')), b.fecha_inicio NULLS LAST, b.id), '[]'::jsonb)
  FROM base b
$fn$;

-- Indicadores de costes (últimos 12 meses): indirecto mensual, % sobre ventas, CI/CD, objetivo
CREATE OR REPLACE FUNCTION r4_kpis_costes() RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  -- Los costes mensuales/anuales son importes de referencia: cuenta el más reciente de cada concepto
  WITH fijos AS (
    SELECT DISTINCT ON (lower(trim(concepto)), periodicidad) importe, periodicidad
      FROM costes WHERE tipo = 'indirecto' AND periodicidad IN ('mensual','anual')
     ORDER BY lower(trim(concepto)), periodicidad, fecha DESC, id DESC),
  ci AS (
    SELECT (SELECT coalesce(sum(CASE periodicidad WHEN 'mensual' THEN importe ELSE importe / 12 END), 0) FROM fijos)
         + (SELECT coalesce(sum(importe), 0) FROM costes WHERE tipo = 'indirecto' AND periodicidad = 'puntual' AND fecha > current_date - 365) / 12 AS mes),
  cd AS (SELECT coalesce(sum(importe), 0) AS c12 FROM costes WHERE tipo = 'directo' AND fecha > current_date - 365),
  mo AS (SELECT coalesce(sum(p.jornadas * r4_coste_jornada(o.coste_mensual, p.categoria)), 0) AS m12
           FROM partes p JOIN operarios o ON o.id = p.operario_id WHERE p.fecha > current_date - 365),
  ve AS (SELECT coalesce(nullif(r4_cfg_num('ventas_anuales_ref'), 0),
                         (SELECT coalesce(sum(importe), 0) FROM certificaciones WHERE estado IN ('conforme','facturada') AND fecha > current_date - 365)) AS v12,
                CASE WHEN coalesce(r4_cfg_num('ventas_anuales_ref'), 0) > 0 THEN 'referencia' ELSE 'certificado_12m' END AS fuente)
  SELECT jsonb_build_object(
    'ci_mensual', round(ci.mes, 2), 'ci_anual', round(ci.mes * 12, 2),
    'cd_12m', round(cd.c12 + mo.m12, 2), 'mo_12m', round(mo.m12, 2), 'ventas_12m', ve.v12, 'ventas_fuente', ve.fuente,
    'pct_ci', CASE WHEN ve.v12 > 0 THEN round(ci.mes * 12 * 100 / ve.v12, 1) END,
    'ratio_ci_cd', CASE WHEN cd.c12 + mo.m12 > 0 THEN round(ci.mes * 12 / (cd.c12 + mo.m12), 2) END,
    'objetivo_beneficio', coalesce(r4_cfg_num('objetivo_beneficio'), 20),
    'umbral_ci', coalesce(r4_cfg_num('umbral_ci'), 15))
  FROM ci, cd, mo, ve
$fn$;

-- Datos de gestión que ve cada rol (se añaden al summary)
CREATE OR REPLACE FUNCTION r4_gestion_summary(rol text) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object(
    'permisos', r4_permisos(rol),
    'obras', CASE WHEN r4_puede(rol, 'ver_obras') THEN r4_obras_json(r4_puede(rol, 'costes')) ELSE '[]'::jsonb END,
    'operarios', CASE WHEN r4_puede(rol, 'ver_obras') THEN (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'categoria', categoria, 'telefono', telefono, 'activo', activo)
             || CASE WHEN r4_puede(rol, 'personal') THEN jsonb_build_object('coste_mensual', coste_mensual,
                  'coste_jornada', r4_coste_jornada(coste_mensual, categoria)) ELSE '{}'::jsonb END ORDER BY activo DESC, categoria, nombre), '[]'::jsonb)
        FROM operarios) ELSE '[]'::jsonb END,
    'partes', CASE WHEN r4_puede(rol, 'ver_obras') THEN (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'obra_id', obra_id, 'fecha', fecha, 'operario_id', operario_id,
             'categoria', categoria, 'jornadas', jornadas) ORDER BY fecha DESC, id), '[]'::jsonb)
        FROM partes WHERE fecha > current_date - 42) ELSE '[]'::jsonb END,
    'costes', CASE WHEN r4_puede(rol, 'costes_obra') THEN (
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.fecha DESC, t.id DESC), '[]'::jsonb) FROM (
        SELECT id, tipo, categoria, obra_id, concepto, proveedor, importe, fecha, periodicidad, origen, documento, created_by
          FROM costes WHERE r4_puede(rol, 'costes') OR (tipo = 'directo' AND obra_id IS NOT NULL)
         ORDER BY fecha DESC, id DESC LIMIT 400) t) ELSE '[]'::jsonb END,
    'kpis_costes', CASE WHEN r4_puede(rol, 'costes') THEN r4_kpis_costes() END,
    'articulos', CASE WHEN r4_puede(rol, 'almacen') THEN (
      SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.nombre), '[]'::jsonb) FROM articulos a) ELSE '[]'::jsonb END,
    'movimientos', CASE WHEN r4_puede(rol, 'almacen') THEN (
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.fecha DESC, t.id DESC), '[]'::jsonb) FROM (
        SELECT m.id, m.articulo_id, a.nombre AS articulo, a.unidad, m.tipo, m.cantidad, m.obra_id, m.coste_unitario, m.fecha, m.origen, m.nota, m.created_by
          FROM movimientos m JOIN articulos a ON a.id = m.articulo_id ORDER BY m.fecha DESC, m.id DESC LIMIT 150) t) ELSE '[]'::jsonb END,
    'partidas', CASE WHEN r4_puede(rol, 'ver_presupuestos') THEN (
      SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.familia, x.codigo), '[]'::jsonb) FROM partidas x) ELSE '[]'::jsonb END,
    'presupuestos', CASE WHEN r4_puede(rol, 'ver_presupuestos') THEN (
      SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.updated_at DESC), '[]'::jsonb) FROM (
        SELECT p.id, p.codigo, p.titulo, p.cliente_id, c.nombre AS cliente_nombre, p.oportunidad_id, p.ubicacion, p.ajuste_pct,
               p.estado, p.obra_id, p.origen, p.notas, p.created_by, p.created_at, p.updated_at,
               r4_presupuesto_totales(p.id) AS totales,
               (SELECT coalesce(jsonb_agg(to_jsonb(l) - 'presupuesto_id' ORDER BY l.orden, l.id), '[]'::jsonb)
                  FROM presupuesto_lineas l WHERE l.presupuesto_id = p.id) AS lineas
          FROM presupuestos p LEFT JOIN clientes c ON c.id = p.cliente_id ORDER BY p.updated_at DESC LIMIT 100) t) ELSE '[]'::jsonb END)
$fn$;

-- Portal del cliente: solo SU obra, sus certificaciones y sus presupuestos (sin costes ni márgenes)
CREATE OR REPLACE FUNCTION r4_portal(cid bigint) RETURNS jsonb LANGUAGE sql STABLE AS $fn$
  SELECT jsonb_build_object(
    'cliente', (SELECT jsonb_build_object('id', c.id, 'nombre', c.nombre, 'empresa', coalesce(g.nombre, c.empresa))
                  FROM clientes c LEFT JOIN organizaciones g ON g.id = c.organizacion_id WHERE c.id = cid),
    'obras', (SELECT coalesce(jsonb_agg(jsonb_set(o - 'notas' - 'presupuesto_url' - 'lineas' - 'jornadas_registradas' - 'jornadas_presupuesto'
                                          - 'material_presupuesto' - 'control_pendiente' - 'ultimo_parte' - 'oficiales' - 'peones' - 'presupuesto_id',
                     '{certificaciones}', (SELECT coalesce(jsonb_agg(c - 'conforme_por'), '[]'::jsonb)
                                             FROM jsonb_array_elements(o->'certificaciones') c WHERE c->>'estado' <> 'borrador'))), '[]'::jsonb)
                FROM jsonb_array_elements(r4_obras_json(false, cid)) o),
    'presupuestos', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'codigo', p.codigo, 'titulo', p.titulo, 'estado', p.estado,
                       'total', r4_presupuesto_totales(p.id)->'total', 'fecha', p.updated_at) ORDER BY p.updated_at DESC), '[]'::jsonb)
                       FROM presupuestos p WHERE p.cliente_id = cid AND p.estado IN ('enviado','aceptado')),
    'config', jsonb_build_object('plataforma_url', (SELECT valor FROM r4_config WHERE clave = 'plataforma_url')))
$fn$;

-- Operaciones de gestión. Devuelve NULL si la operación no es de gestión (la resuelve r4_api).
CREATE OR REPLACE FUNCTION r4_gestion(p jsonb, v_rol text, v_actor text) RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_op   text := p->>'op';
  v_id   bigint := nullif(p->>'id', '')::bigint;
  v_obra bigint := nullif(p->>'obra_id', '')::bigint;
  v_quien text := coalesce(nullif(v_actor, ''), 'direccion');
  n      int;
  x      jsonb;
  o      obras%ROWTYPE;
  pr     presupuestos%ROWTYPE;
  ce     certificaciones%ROWTYPE;
  ar     articulos%ROWTYPE;
  tot    jsonb;
  ver    int;
  lin    int;
  sin_permiso jsonb := jsonb_build_object('ok', false, 'forbidden', true, 'error', 'tu rol no permite esta operación');
BEGIN
  -- ---------- personal de obra ----------
  IF v_op = 'operario_set' THEN
    IF NOT r4_puede(v_rol, 'personal') THEN RETURN sin_permiso; END IF;
    IF v_id IS NULL THEN
      INSERT INTO operarios (nombre, categoria, coste_mensual, telefono)
      VALUES (left(trim(p->>'nombre'), 80), coalesce(nullif(p->>'categoria', ''), 'oficial'),
              nullif(p->>'coste_mensual', '')::numeric, nullif(left(p->>'telefono', 30), ''))
      RETURNING id INTO v_id;
    ELSE
      UPDATE operarios SET nombre = coalesce(nullif(left(trim(p->>'nombre'), 80), ''), nombre),
             categoria = coalesce(nullif(p->>'categoria', ''), categoria),
             coste_mensual = CASE WHEN p ? 'coste_mensual' THEN nullif(p->>'coste_mensual', '')::numeric ELSE coste_mensual END,
             telefono = CASE WHEN p ? 'telefono' THEN nullif(left(p->>'telefono', 30), '') ELSE telefono END,
             activo = coalesce((p->>'activo')::boolean, activo), updated_at = now()
       WHERE id = v_id;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'operario no encontrado'); END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  -- ---------- obras ----------
  ELSIF v_op = 'obra_set' THEN
    IF NOT r4_puede(v_rol, 'obras') THEN RETURN sin_permiso; END IF;
    IF p->>'estado' = 'facturada' AND NOT r4_puede(v_rol, 'facturar') THEN
      RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'solo Dirección marca una obra como facturada');
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO obras (codigo, titulo, cliente_id, oportunidad_id, ubicacion, estado, fecha_inicio, oficiales, peones,
                         periodo_control, presupuesto_url, notas, created_by)
      VALUES (left(trim(p->>'codigo'), 40), left(trim(p->>'titulo'), 200), nullif(p->>'cliente_id', '')::bigint,
              nullif(p->>'oportunidad_id', '')::bigint, nullif(left(p->>'ubicacion', 200), ''),
              coalesce(nullif(p->>'estado', ''), 'planificada'), nullif(p->>'fecha_inicio', '')::date,
              coalesce(nullif(p->>'oficiales', '')::int, 2), coalesce(nullif(p->>'peones', '')::int, 1),
              coalesce(nullif(p->>'periodo_control', ''), 'semanal'), nullif(left(p->>'presupuesto_url', 500), ''),
              nullif(left(p->>'notas', 2000), ''), v_quien)
      RETURNING id INTO v_id;
      INSERT INTO obra_presupuestos (obra_id, linea, version, importe, jornadas, material, motivo, created_by)
      VALUES (v_id, 0, 0, coalesce(nullif(p->>'importe', '')::numeric, 0), coalesce(nullif(p->>'jornadas', '')::numeric, 0),
              coalesce(nullif(p->>'material', '')::numeric, 0), 'Presupuesto original', v_quien);
      INSERT INTO eventos (agente, texto, ref) VALUES ('OBRAS', 'Obra ' || (p->>'codigo') || ' abierta: ' || left(p->>'titulo', 120) || '.', 'obra:' || v_id);
    ELSE
      UPDATE obras SET
        codigo = coalesce(nullif(left(trim(p->>'codigo'), 40), ''), codigo),
        titulo = coalesce(nullif(left(trim(p->>'titulo'), 200), ''), titulo),
        cliente_id = CASE WHEN p ? 'cliente_id' THEN nullif(p->>'cliente_id', '')::bigint ELSE cliente_id END,
        ubicacion = CASE WHEN p ? 'ubicacion' THEN nullif(left(p->>'ubicacion', 200), '') ELSE ubicacion END,
        estado = coalesce(nullif(p->>'estado', ''), estado),
        fecha_inicio = CASE WHEN p ? 'fecha_inicio' THEN nullif(p->>'fecha_inicio', '')::date ELSE fecha_inicio END,
        oficiales = coalesce(nullif(p->>'oficiales', '')::int, oficiales),
        peones = coalesce(nullif(p->>'peones', '')::int, peones),
        periodo_control = coalesce(nullif(p->>'periodo_control', ''), periodo_control),
        presupuesto_url = CASE WHEN p ? 'presupuesto_url' THEN nullif(left(p->>'presupuesto_url', 500), '') ELSE presupuesto_url END,
        notas = CASE WHEN p ? 'notas' THEN nullif(left(p->>'notas', 2000), '') ELSE notas END,
        updated_at = now()
      WHERE id = v_id;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'obra no encontrada'); END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  ELSIF v_op = 'obra_version' THEN   -- modificación de una línea (mod n) o nueva extensión (ext n)
    IF NOT r4_puede(v_rol, 'obras') THEN RETURN sin_permiso; END IF;
    SELECT * INTO o FROM obras WHERE id = v_obra;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'obra no encontrada'); END IF;
    IF p->>'linea' = 'nueva' THEN
      SELECT coalesce(max(linea), 0) + 1 INTO lin FROM obra_presupuestos WHERE obra_id = v_obra;
      ver := 0;
    ELSE
      lin := coalesce(nullif(p->>'linea', '')::int, 0);
      SELECT max(version) + 1 INTO ver FROM obra_presupuestos WHERE obra_id = v_obra AND linea = lin;
      IF ver IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'línea de presupuesto no encontrada'); END IF;
    END IF;
    INSERT INTO obra_presupuestos (obra_id, linea, version, importe, jornadas, material, motivo, created_by)
    VALUES (v_obra, lin, ver, coalesce(nullif(p->>'importe', '')::numeric, 0), coalesce(nullif(p->>'jornadas', '')::numeric, 0),
            coalesce(nullif(p->>'material', '')::numeric, 0), nullif(left(p->>'motivo', 300), ''), v_quien);
    INSERT INTO eventos (agente, texto, ref) VALUES ('OBRAS', 'Obra ' || o.codigo
      || CASE WHEN lin > 0 THEN ' ext ' || lin ELSE '' END || CASE WHEN ver > 0 THEN ' mod ' || ver ELSE '' END
      || ': ' || to_char(coalesce(nullif(p->>'importe', '')::numeric, 0), 'FM999G999G990D00') || ' € · '
      || coalesce(nullif(p->>'jornadas', ''), '0') || ' jornadas.', 'obra:' || v_obra);
    RETURN jsonb_build_object('ok', true, 'obra_id', v_obra, 'linea', lin, 'version', ver);

  ELSIF v_op = 'parte_set' THEN      -- reemplaza el parte de una obra y un día
    IF NOT r4_puede(v_rol, 'partes') THEN RETURN sin_permiso; END IF;
    SELECT * INTO o FROM obras WHERE id = v_obra;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'obra no encontrada'); END IF;
    IF nullif(p->>'fecha', '') IS NULL OR (p->>'fecha')::date > current_date + 1 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'fecha del parte no válida');
    END IF;
    IF v_rol NOT IN ('direccion','administracion') AND (p->>'fecha')::date < current_date - 14 THEN
      RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'partes de más de 14 días: pídeselo a secretaría');
    END IF;
    DELETE FROM partes WHERE obra_id = v_obra AND fecha = (p->>'fecha')::date;
    INSERT INTO partes (obra_id, fecha, operario_id, categoria, jornadas, created_by)
    SELECT v_obra, (p->>'fecha')::date, (e->>'id')::bigint,
           coalesce(nullif(e->>'categoria', ''), op.categoria), coalesce(nullif(e->>'jornadas', '')::numeric, 1), v_quien
      FROM jsonb_array_elements(coalesce(p->'operarios', '[]'::jsonb)) e
      JOIN operarios op ON op.id = (e->>'id')::bigint;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO eventos (agente, texto, ref) VALUES ('OBRAS', 'Parte de la obra ' || o.codigo || ' del ' || to_char((p->>'fecha')::date, 'DD/MM/YYYY')
      || ': ' || n || ' operario' || CASE WHEN n = 1 THEN '' ELSE 's' END || ' (por ' || v_quien || ').', 'obra:' || v_obra);
    IF n > 0 AND o.estado = 'planificada' THEN
      UPDATE obras SET estado = 'en_curso', fecha_inicio = coalesce(fecha_inicio, (p->>'fecha')::date), updated_at = now() WHERE id = v_obra;
    END IF;
    RETURN jsonb_build_object('ok', true, 'obra_id', v_obra, 'operarios', n);

  -- ---------- costes ----------
  ELSIF v_op = 'coste_add' THEN       -- uno o varios (Excel, PDF, foto, manual)
    FOR x IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'costes') = 'array' THEN p->'costes' ELSE jsonb_build_array(p) END) LOOP
      IF NOT (r4_puede(v_rol, 'costes') OR (r4_puede(v_rol, 'costes_obra') AND x->>'tipo' = 'directo' AND nullif(x->>'obra_id', '') IS NOT NULL)) THEN
        RETURN sin_permiso;
      END IF;
      IF (x->>'importe')::numeric < 0 AND NOT r4_puede(v_rol, 'costes') THEN
        RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'los abonos (importes negativos) los registra secretaría o Dirección');
      END IF;
      IF nullif(x->>'obra_id', '') IS NOT NULL AND NOT EXISTS (SELECT 1 FROM obras WHERE id = (x->>'obra_id')::bigint) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'la obra indicada no existe');
      END IF;
    END LOOP;
    INSERT INTO costes (tipo, categoria, obra_id, concepto, proveedor, importe, fecha, periodicidad, origen, documento, created_by)
    SELECT e->>'tipo', coalesce(nullif(e->>'categoria', ''), 'otros'), nullif(e->>'obra_id', '')::bigint,
           left(trim(e->>'concepto'), 300), nullif(left(e->>'proveedor', 120), ''), (e->>'importe')::numeric,
           coalesce(nullif(e->>'fecha', '')::date, current_date), coalesce(nullif(e->>'periodicidad', ''), 'puntual'),
           coalesce(nullif(e->>'origen', ''), 'manual'), nullif(left(e->>'documento', 300), ''), v_quien
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p->'costes') = 'array' THEN p->'costes' ELSE jsonb_build_array(p) END) e;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'insertados', n);

  ELSIF v_op = 'coste_del' THEN
    IF NOT r4_puede(v_rol, 'costes') THEN RETURN sin_permiso; END IF;
    DELETE FROM costes WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  -- ---------- almacén ----------
  ELSIF v_op = 'articulo_set' THEN
    IF NOT r4_puede(v_rol, 'almacen') THEN RETURN sin_permiso; END IF;
    IF v_id IS NULL THEN
      INSERT INTO articulos (nombre, unidad, coste_unitario, minimo)
      VALUES (left(trim(p->>'nombre'), 120), coalesce(nullif(left(p->>'unidad', 12), ''), 'ud'),
              coalesce(nullif(p->>'coste_unitario', '')::numeric, 0), coalesce(nullif(p->>'minimo', '')::numeric, 0))
      RETURNING id INTO v_id;
    ELSE
      UPDATE articulos SET nombre = coalesce(nullif(left(trim(p->>'nombre'), 120), ''), nombre),
             unidad = coalesce(nullif(left(p->>'unidad', 12), ''), unidad),
             coste_unitario = coalesce(nullif(p->>'coste_unitario', '')::numeric, coste_unitario),
             minimo = coalesce(nullif(p->>'minimo', '')::numeric, minimo), updated_at = now()
       WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  ELSIF v_op = 'movimiento_add' THEN  -- entrada al almacén o salida a obra (la salida es coste de material de esa obra)
    IF NOT r4_puede(v_rol, 'almacen') THEN RETURN sin_permiso; END IF;
    SELECT * INTO ar FROM articulos WHERE id = nullif(p->>'articulo_id', '')::bigint;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'artículo no encontrado'); END IF;
    IF p->>'tipo' = 'salida' AND v_obra IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'indica la obra de destino'); END IF;
    IF v_obra IS NOT NULL AND NOT EXISTS (SELECT 1 FROM obras WHERE id = v_obra) THEN RETURN jsonb_build_object('ok', false, 'error', 'la obra indicada no existe'); END IF;
    INSERT INTO movimientos (articulo_id, tipo, cantidad, obra_id, coste_unitario, fecha, origen, nota, created_by)
    VALUES (ar.id, p->>'tipo', (p->>'cantidad')::numeric, v_obra,
            CASE WHEN p->>'tipo' = 'entrada' THEN coalesce(nullif(p->>'coste_unitario', '')::numeric, ar.coste_unitario) ELSE ar.coste_unitario END,
            coalesce(nullif(p->>'fecha', '')::date, current_date), coalesce(nullif(p->>'origen', ''), 'manual'),
            nullif(left(p->>'nota', 300), ''), v_quien);
    UPDATE articulos SET stock = stock + CASE WHEN p->>'tipo' = 'entrada' THEN 1 ELSE -1 END * (p->>'cantidad')::numeric,
           coste_unitario = CASE WHEN p->>'tipo' = 'entrada' AND nullif(p->>'coste_unitario', '') IS NOT NULL
                                 THEN (p->>'coste_unitario')::numeric ELSE coste_unitario END,
           updated_at = now()
     WHERE id = ar.id RETURNING * INTO ar;
    IF p->>'tipo' = 'salida' THEN
      INSERT INTO costes (tipo, categoria, obra_id, concepto, importe, fecha, origen, created_by)
      VALUES ('directo', 'material', v_obra, 'Almacén: ' || (p->>'cantidad') || ' ' || ar.unidad || ' de ' || ar.nombre,
              round((p->>'cantidad')::numeric * ar.coste_unitario, 2),
              coalesce(nullif(p->>'fecha', '')::date, current_date), 'almacen', v_quien);
    END IF;
    RETURN jsonb_build_object('ok', true, 'stock', ar.stock, 'aviso', CASE WHEN ar.stock < 0 THEN 'stock negativo: falta registrar una entrada' END);

  -- ---------- certificaciones ----------
  ELSIF v_op = 'cert_set' THEN
    IF NOT r4_puede(v_rol, 'certificar') THEN RETURN sin_permiso; END IF;
    IF v_id IS NULL THEN
      SELECT * INTO o FROM obras WHERE id = v_obra;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'obra no encontrada'); END IF;
      INSERT INTO certificaciones (obra_id, numero, tipo, fecha, importe, notas, created_by)
      VALUES (v_obra, (SELECT coalesce(max(numero), 0) + 1 FROM certificaciones WHERE obra_id = v_obra),
              coalesce(nullif(p->>'tipo', ''), 'parcial'), coalesce(nullif(p->>'fecha', '')::date, current_date),
              (p->>'importe')::numeric, nullif(left(p->>'notas', 1000), ''), v_quien)
      RETURNING id INTO v_id;
    ELSE
      UPDATE certificaciones SET tipo = coalesce(nullif(p->>'tipo', ''), tipo), fecha = coalesce(nullif(p->>'fecha', '')::date, fecha),
             importe = coalesce(nullif(p->>'importe', '')::numeric, importe),
             notas = CASE WHEN p ? 'notas' THEN nullif(left(p->>'notas', 1000), '') ELSE notas END, updated_at = now()
       WHERE id = v_id AND estado = 'borrador';
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'solo se editan certificaciones en borrador'); END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  ELSIF v_op = 'cert_estado' THEN
    SELECT * INTO ce FROM certificaciones WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'certificación no encontrada'); END IF;
    IF NOT (  (p->>'estado' = 'enviada'   AND ce.estado = 'borrador' AND r4_puede(v_rol, 'certificar'))
           OR (p->>'estado' = 'borrador'  AND ce.estado = 'enviada'  AND r4_puede(v_rol, 'certificar'))
           OR (p->>'estado' = 'conforme'  AND ce.estado = 'enviada'  AND r4_puede(v_rol, 'facturar'))
           OR (p->>'estado' = 'facturada' AND ce.estado = 'conforme' AND r4_puede(v_rol, 'facturar'))) THEN
      RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'cambio de estado no permitido');
    END IF;
    UPDATE certificaciones SET estado = p->>'estado', updated_at = now(),
           conforme_por = CASE WHEN p->>'estado' = 'conforme' THEN 'Dirección (' || v_quien || ')' ELSE conforme_por END,
           conforme_at  = CASE WHEN p->>'estado' = 'conforme' THEN now() ELSE conforme_at END
     WHERE id = v_id;
    IF ce.tipo = 'final' AND p->>'estado' = 'conforme' THEN UPDATE obras SET estado = 'terminada', updated_at = now() WHERE id = ce.obra_id; END IF;
    IF ce.tipo = 'final' AND p->>'estado' = 'facturada' THEN UPDATE obras SET estado = 'facturada', updated_at = now() WHERE id = ce.obra_id; END IF;
    INSERT INTO eventos (agente, texto, ref) VALUES ('OBRAS', 'Certificación ' || ce.tipo || ' nº ' || ce.numero || ' de la obra '
      || (SELECT codigo FROM obras WHERE id = ce.obra_id) || ': ' || (p->>'estado') || '.', 'obra:' || ce.obra_id);
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'estado', p->>'estado');

  -- ---------- presupuestos ----------
  ELSIF v_op = 'partida_set' THEN
    IF NOT r4_puede(v_rol, 'precios') THEN RETURN sin_permiso; END IF;
    IF v_id IS NULL THEN
      INSERT INTO partidas (codigo, descripcion, unidad, precio, material_pct, jornadas_ud, familia)
      VALUES (left(trim(p->>'codigo'), 20), left(trim(p->>'descripcion'), 200), coalesce(nullif(left(p->>'unidad', 12), ''), 'ud'),
              nullif(p->>'precio', '')::numeric, coalesce(nullif(p->>'material_pct', '')::numeric, 40),
              coalesce(nullif(p->>'jornadas_ud', '')::numeric, 0), nullif(left(p->>'familia', 60), ''))
      RETURNING id INTO v_id;
    ELSE
      UPDATE partidas SET descripcion = coalesce(nullif(left(trim(p->>'descripcion'), 200), ''), descripcion),
             unidad = coalesce(nullif(left(p->>'unidad', 12), ''), unidad),
             precio = CASE WHEN p ? 'precio' THEN nullif(p->>'precio', '')::numeric ELSE precio END,
             material_pct = coalesce(nullif(p->>'material_pct', '')::numeric, material_pct),
             jornadas_ud = coalesce(nullif(p->>'jornadas_ud', '')::numeric, jornadas_ud),
             familia = coalesce(nullif(left(p->>'familia', 60), ''), familia),
             activo = coalesce((p->>'activo')::boolean, activo), updated_at = now()
       WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', v_id);

  ELSIF v_op = 'presupuesto_set' THEN
    IF NOT r4_puede(v_rol, 'presupuestos') THEN RETURN sin_permiso; END IF;
    IF v_id IS NULL THEN
      INSERT INTO presupuestos (codigo, titulo, cliente_id, oportunidad_id, ubicacion, ajuste_pct, notas, origen, created_by)
      VALUES (left(trim(p->>'codigo'), 40), left(trim(p->>'titulo'), 200), nullif(p->>'cliente_id', '')::bigint,
              nullif(p->>'oportunidad_id', '')::bigint, nullif(left(p->>'ubicacion', 200), ''),
              coalesce(nullif(p->>'ajuste_pct', '')::numeric, 0), nullif(left(p->>'notas', 2000), ''),
              coalesce(nullif(p->>'origen', ''), 'plataforma'), v_quien)
      RETURNING * INTO pr;
    ELSE
      UPDATE presupuestos SET titulo = coalesce(nullif(left(trim(p->>'titulo'), 200), ''), titulo),
             cliente_id = CASE WHEN p ? 'cliente_id' THEN nullif(p->>'cliente_id', '')::bigint ELSE cliente_id END,
             ubicacion = CASE WHEN p ? 'ubicacion' THEN nullif(left(p->>'ubicacion', 200), '') ELSE ubicacion END,
             ajuste_pct = coalesce(nullif(p->>'ajuste_pct', '')::numeric, ajuste_pct),
             notas = CASE WHEN p ? 'notas' THEN nullif(left(p->>'notas', 2000), '') ELSE notas END, updated_at = now()
       WHERE id = v_id AND estado IN ('borrador','enviado') RETURNING * INTO pr;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'solo se editan presupuestos en borrador o enviados'); END IF;
    END IF;
    IF jsonb_typeof(p->'lineas') = 'array' THEN
      DELETE FROM presupuesto_lineas WHERE presupuesto_id = pr.id;
      INSERT INTO presupuesto_lineas (presupuesto_id, orden, partida_id, descripcion, unidad, cantidad, precio, material_pct, jornadas_ud)
      SELECT pr.id, (ord - 1)::int, nullif(l->>'partida_id', '')::bigint, left(trim(coalesce(l->>'descripcion', '')), 300),
             coalesce(nullif(left(l->>'unidad', 12), ''), 'ud'), coalesce(nullif(l->>'cantidad', '')::numeric, 0),
             coalesce(nullif(l->>'precio', '')::numeric, 0), coalesce(nullif(l->>'material_pct', '')::numeric, 0),
             coalesce(nullif(l->>'jornadas_ud', '')::numeric, 0)
        FROM jsonb_array_elements(p->'lineas') WITH ORDINALITY AS t(l, ord)
       WHERE coalesce(trim(l->>'descripcion'), '') <> '';
    END IF;
    RETURN jsonb_build_object('ok', true, 'id', pr.id, 'totales', r4_presupuesto_totales(pr.id));

  ELSIF v_op = 'presupuesto_estado' THEN
    SELECT * INTO pr FROM presupuestos WHERE id = v_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'presupuesto no encontrado'); END IF;
    IF p->>'estado' IN ('enviado','rechazado','borrador') THEN
      IF NOT r4_puede(v_rol, 'presupuestos') THEN RETURN sin_permiso; END IF;
      IF pr.estado = 'aceptado' THEN RETURN jsonb_build_object('ok', false, 'error', 'ya está aceptado y tiene obra'); END IF;
      UPDATE presupuestos SET estado = p->>'estado', updated_at = now() WHERE id = v_id;
      RETURN jsonb_build_object('ok', true, 'id', v_id, 'estado', p->>'estado');
    ELSIF p->>'estado' = 'aceptado' THEN    -- Dirección aprueba: el presupuesto se «cuelga» en Obras
      IF NOT r4_puede(v_rol, 'aprobar') THEN RETURN sin_permiso; END IF;
      IF pr.estado = 'aceptado' THEN RETURN jsonb_build_object('ok', false, 'error', 'ya estaba aceptado'); END IF;
      IF EXISTS (SELECT 1 FROM obras WHERE lower(codigo) = lower(pr.codigo)) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'ya existe una obra con el código ' || pr.codigo);
      END IF;
      tot := r4_presupuesto_totales(v_id);
      INSERT INTO obras (codigo, titulo, cliente_id, oportunidad_id, ubicacion, presupuesto_id, fecha_inicio, created_by)
      VALUES (pr.codigo, pr.titulo, pr.cliente_id, pr.oportunidad_id, pr.ubicacion, pr.id, nullif(p->>'fecha_inicio', '')::date, v_quien)
      RETURNING * INTO o;
      INSERT INTO obra_presupuestos (obra_id, linea, version, importe, jornadas, material, motivo, created_by)
      VALUES (o.id, 0, 0, (tot->>'total')::numeric, (tot->>'jornadas')::numeric, (tot->>'material')::numeric, 'Presupuesto ' || pr.codigo || ' aceptado', v_quien);
      UPDATE presupuestos SET estado = 'aceptado', obra_id = o.id, updated_at = now() WHERE id = v_id;
      IF pr.oportunidad_id IS NOT NULL THEN
        UPDATE oportunidades SET etapa = 'aceptado', importe = (tot->>'total')::numeric, updated_at = now() WHERE id = pr.oportunidad_id;
      END IF;
      INSERT INTO eventos (agente, texto, ref) VALUES ('DIRECCION', 'Presupuesto ' || pr.codigo || ' aceptado (' || (tot->>'total')
        || ' €): obra abierta en Obras.', 'obra:' || o.id);
      RETURN jsonb_build_object('ok', true, 'id', v_id, 'estado', 'aceptado', 'obra_id', o.id);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'estado no válido');
  END IF;
  RETURN NULL;
EXCEPTION WHEN data_exception OR integrity_constraint_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'datos no válidos: ' || left(SQLERRM, 160));
END
$fn$;

-- ---------------------------------------------------------------------
-- 5) Puerta de la API (llamada por el flujo "R4 · API" desde la plataforma)
--    p = {op: summary | set_config | update_extraccion | set_etapa | update_inmueble | usuario_set | reenviar_wa | marcar_cliente | marcar_ignorado | auth_login, actor:{email, rol, via}, ...}
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
  permitidas text[] := ARRAY['evolution_url','evolution_instancia','wa_destino_direccion','wa_campos','eco_activo','gmail_cuenta','plataforma_url',
                             'objetivo_beneficio','umbral_ci','coste_jornada_oficial','coste_jornada_peon','dias_nomina','correo_materiales','ventas_anuales_ref'];
  v_actor text := lower(coalesce(p->'actor'->>'email', ''));
  v_via   text := coalesce(p->'actor'->>'via', '');
  v_rol   text;
  v_obj   text;
  v_cli   bigint;
  u       usuarios%ROWTYPE;
  ce      certificaciones%ROWTYPE;
BEGIN
  -- Alta/entrada con Google: solo la llama Vercel desde el callback (no está en la lista blanca del navegador)
  IF v_op = 'auth_login' THEN
    RETURN r4_auth_login(p);
  END IF;

  -- Autorización: el rol se lee en cada petición, así un cambio o bloqueo de Dirección es inmediato
  IF v_via = 'password' THEN
    v_rol := 'direccion';                       -- acceso de emergencia con contraseña de Dirección
  ELSIF v_actor = '' THEN
    RETURN jsonb_build_object('ok', false, 'auth', false, 'error', 'petición sin usuario');
  ELSE
    SELECT * INTO u FROM usuarios WHERE email = v_actor AND estado = 'activo';
    v_rol := u.rol;
    IF v_rol IS NULL OR v_rol = 'pendiente' THEN
      RETURN jsonb_build_object('ok', false, 'auth', false, 'error', 'acceso pendiente o retirado por Dirección');
    END IF;
  END IF;
  -- Clientes: solo su portal y dar conformidad a sus certificaciones
  IF v_rol = 'cliente' THEN
    IF u.cliente_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'auth', false, 'error', 'tu cuenta aún no está vinculada a una ficha de cliente');
    END IF;
    IF v_op = 'summary' THEN
      RETURN jsonb_build_object('ok', true, 'data', jsonb_build_object('portal', r4_portal(u.cliente_id),
        'yo', jsonb_build_object('email', v_actor, 'rol', v_rol, 'via', v_via, 'nombre', u.nombre)));
    ELSIF v_op = 'cert_conforme' THEN
      SELECT c.* INTO ce FROM certificaciones c JOIN obras o ON o.id = c.obra_id
       WHERE c.id = v_id AND o.cliente_id = u.cliente_id AND c.estado = 'enviada';
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'certificación no disponible para conformar'); END IF;
      UPDATE certificaciones SET estado = 'conforme', conforme_por = 'Cliente (' || v_actor || ')', conforme_at = now(), updated_at = now()
       WHERE id = v_id AND estado = 'enviada';
      IF ce.tipo = 'final' THEN UPDATE obras SET estado = 'terminada', updated_at = now() WHERE id = ce.obra_id; END IF;
      INSERT INTO eventos (agente, nivel, texto, ref) VALUES ('CLIENTE', 'info', 'El cliente ' || coalesce(u.nombre, v_actor)
        || ' da su conformidad a la certificación ' || ce.tipo || ' nº ' || ce.numero || ' de la obra '
        || (SELECT codigo FROM obras WHERE id = ce.obra_id) || ': lista para facturar.', 'obra:' || ce.obra_id);
      RETURN jsonb_build_object('ok', true, 'id', v_id, 'estado', 'conforme');
    END IF;
    RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'operación no disponible en el portal de cliente');
  END IF;

  IF v_op IN ('set_config', 'usuario_set') AND v_rol <> 'direccion' THEN
    RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'solo Dirección puede hacer este cambio');
  END IF;
  IF v_op IN ('update_extraccion','set_etapa','update_inmueble','reenviar_wa','marcar_cliente','marcar_ignorado')
     AND NOT r4_puede(v_rol, 'crm') THEN
    RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'tu rol es de solo lectura');
  END IF;

  IF v_op = 'summary' THEN
    res := r4_summary();
    IF NOT r4_puede(v_rol, 'crm') THEN   -- encargado y colaborador: nada del CRM ni de la Bandeja
      res := res - 'mensajes' - 'clientes' - 'oportunidades' - 'inmuebles'
             || jsonb_build_object('kpis', '{}'::jsonb, 'canales', '{}'::jsonb);
    END IF;
    IF NOT (r4_puede(v_rol, 'costes') OR r4_puede(v_rol, 'personal')) THEN
      res := jsonb_set(res, '{config}', (res->'config') - 'coste_jornada_oficial' - 'coste_jornada_peon' - 'ventas_anuales_ref'
                                         - 'objetivo_beneficio' - 'umbral_ci' - 'dias_nomina');
    END IF;
    IF v_rol <> 'direccion' THEN
      -- Solo Dirección ve solicitudes de acceso y los datos completos de integración
      res := res || jsonb_build_object(
        'eventos', coalesce((SELECT jsonb_agg(e) FROM jsonb_array_elements(res->'eventos') e WHERE coalesce(e->>'ref','') NOT LIKE 'usuario:%'), '[]'::jsonb),
        'config', (res->'config') || jsonb_build_object(
          'evolution_url', CASE WHEN coalesce(res->'config'->>'evolution_url','') <> '' THEN 'configurada' ELSE '' END,
          'wa_destino_direccion', CASE WHEN coalesce(res->'config'->>'wa_destino_direccion','') <> '' THEN '•••' || right(res->'config'->>'wa_destino_direccion', 3) ELSE '' END));
    END IF;
    RETURN jsonb_build_object('ok', true, 'data', res || r4_gestion_summary(v_rol) || jsonb_build_object(
      'yo', jsonb_build_object('email', v_actor, 'rol', v_rol, 'via', v_via),
      'usuarios', CASE WHEN v_rol = 'direccion' THEN (
        SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY (t.estado = 'pendiente') DESC, t.created_at DESC), '[]'::jsonb) FROM (
          SELECT u2.email, u2.nombre, u2.foto, u2.rol, u2.estado, u2.solicitud, u2.cliente_id, u2.aprobado_por, u2.aprobado_at,
                 u2.ultimo_acceso, u2.accesos, u2.created_at,
                 (SELECT c.id FROM clientes c WHERE lower(c.email) = u2.email ORDER BY c.id LIMIT 1) AS cliente_sugerido
            FROM usuarios u2) t)
      ELSE NULL END));

  ELSIF v_op = 'doc_permiso' THEN       -- /api/doc: rol vigente, límite de lecturas con IA por hora y registro
    IF NOT r4_puede(v_rol, 'costes_obra') THEN RETURN jsonb_build_object('ok', false, 'forbidden', true, 'error', 'tu rol no registra facturas'); END IF;
    IF (SELECT count(*) FROM eventos WHERE agente = 'DOC' AND ref = 'usuario:' || coalesce(nullif(v_actor, ''), 'direccion')
          AND created_at > now() - interval '1 hour') >= 60 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'límite de 60 lecturas por hora: espera un poco');
    END IF;
    INSERT INTO eventos (agente, texto, ref) VALUES ('DOC', 'Lectura de documento con IA: ' || left(coalesce(p->>'nombre', 'documento'), 80), 'usuario:' || coalesce(nullif(v_actor, ''), 'direccion'));
    RETURN jsonb_build_object('ok', true, 'rol', v_rol);

  ELSIF v_op = 'usuario_set' THEN
    v_obj := lower(coalesce(p->>'email', ''));
    IF v_obj = v_actor THEN RETURN jsonb_build_object('ok', false, 'error', 'no puedes cambiar tu propio acceso'); END IF;
    SELECT * INTO u FROM usuarios WHERE email = v_obj;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'usuario no encontrado'); END IF;
    -- Un cliente siempre va vinculado a su ficha del CRM (la elegida o la que coincide por email)
    IF coalesce(nullif(p->>'rol', ''), u.rol) = 'cliente' THEN
      v_cli := coalesce(nullif(p->>'cliente_id', '')::bigint, u.cliente_id, (SELECT id FROM clientes WHERE lower(email) = v_obj ORDER BY id LIMIT 1));
      IF v_cli IS NULL OR NOT EXISTS (SELECT 1 FROM clientes WHERE id = v_cli) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'elige la ficha de cliente del CRM que verá esta cuenta');
      END IF;
    END IF;
    UPDATE usuarios SET
      rol    = CASE WHEN p->>'rol' IN ('direccion','tecnico','comercial','administracion','encargado','colaborador','cliente') THEN p->>'rol' ELSE rol END,
      cliente_id = CASE WHEN coalesce(nullif(p->>'rol', ''), rol) = 'cliente' THEN v_cli ELSE NULL END,
      estado = CASE WHEN p->>'estado' IN ('activo','bloqueado') THEN p->>'estado' ELSE estado END,
      aprobado_por = CASE WHEN p->>'estado' = 'activo' AND u.estado <> 'activo' THEN coalesce(nullif(v_actor,''), 'direccion') ELSE aprobado_por END,
      aprobado_at  = CASE WHEN p->>'estado' = 'activo' AND u.estado <> 'activo' THEN now() ELSE aprobado_at END,
      updated_at = now()
    WHERE email = v_obj RETURNING * INTO u;
    IF u.estado = 'activo' AND u.rol = 'pendiente' THEN
      UPDATE usuarios SET rol = 'colaborador' WHERE email = v_obj RETURNING * INTO u;
    END IF;
    INSERT INTO eventos (agente, nivel, texto, ref)
    VALUES ('DIRECCION', CASE WHEN u.estado = 'bloqueado' THEN 'warn' ELSE 'info' END,
            'Acceso de ' || coalesce(u.nombre, u.email) || ': ' || u.estado || ' · rol ' || u.rol || ' (por ' || coalesce(nullif(v_actor,''), 'Dirección') || ').',
            'usuario:' || v_obj);
    RETURN jsonb_build_object('ok', true, 'email', u.email, 'rol', u.rol, 'estado', u.estado);

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

  res := r4_gestion(p, v_rol, v_actor);   -- obras, partes, costes, almacén, certificaciones, presupuestos
  IF res IS NOT NULL THEN RETURN res; END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'operación desconocida: ' || v_op);
END
$fn$;

INSERT INTO eventos (agente, texto) VALUES ('SISTEMA', 'Esquema R4 v1 instalado o actualizado.');

SELECT jsonb_build_object('ok', true, 'tablas', (SELECT count(*) FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('r4_config','clientes','organizaciones','inmuebles','oportunidades','mensajes','eventos','usuarios','operarios','obras','obra_presupuestos','partes','costes','articulos','movimientos','certificaciones','partidas','presupuestos','presupuesto_lineas'))) AS r;
