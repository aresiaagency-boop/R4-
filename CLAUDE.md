# CLAUDE.md · Plataforma R4

Plataforma de gestión de **R4 Rehabilitación de Estructuras** (Arenal, Mallorca), construida por A.R.E.S. I.A.
Agentes: **ATLAS** (WhatsApp, Evolution API) y **ECO** (Gmail → extracción IA → Postgres → aviso por WhatsApp).
Lee `MEMORY.md` antes de empezar y actualízalo al terminar (regla 10).
**Especificación funcional:** `docs/PROPUESTA.md` (resumen + estado por módulo) y `docs/R4_Propuesta_de_desarrollo.pdf` (original). Toda tarea se encaja en una fase de esa hoja de ruta.

## Arquitectura v1

```
Gmail (cuenta nueva R4) ──► n8n «R4 · ECO» ──► OpenAI (JSON estricto) ──► Postgres r4 ──► Evolution API ──► WhatsApp Dirección
WhatsApp cliente ──► Evolution ──► n8n «ATLASR4» (/webhook/atlasr4) ──► AI Agent + memoria Postgres ──► respuesta
Navegador ──► Vercel (public/ + api/) ──► n8n «R4 · API» (/webhook/r4-api, x-r4-key) ──► SELECT r4_api(...) ──► Postgres
```

- Modelo CRM según la Propuesta: `clientes` (contacto) → `organizaciones` → `inmuebles` (alerta IEE) → `oportunidades` (con motivo de pérdida); `mensajes` + `eventos` = actividad.
- Postgres **no** está expuesto a internet (EasyPanel, host interno `r4_postgres:5432`, BD `r4`). Solo n8n lo toca.
- Toda la lógica de datos vive en funciones SQL `r4_*` (`db/schema.sql`). n8n solo hace `SELECT r4_x($1::jsonb)`.
- Vercel no guarda datos: valida sesión, filtra operaciones (lista blanca) y reenvía a n8n.

## Acceso · login con Google y control de Dirección (v1.4)

```
Portal «Entrar con Google» ─► /api/auth/google (state anti-CSRF) ─► Google (openid email profile)
  ─► /api/auth/callback: token + tokeninfo (aud, iss, email_verified) ─► n8n r4_api{op:auth_login} ─► tabla usuarios
  ─► activo → cookie r4_session firmada {e,n,r,v,exp} · pendiente/bloqueado → /?acceso=pendiente|bloqueado
```

- `usuarios(email, rol, estado)`: roles `direccion · tecnico · comercial · administracion · colaborador`; estados `pendiente · activo · bloqueado`.
- Cuentas de `R4_DIRECCION_EMAILS` entran SIEMPRE como Dirección (si alguien las bloquea, vuelven a activo al entrar). Resto: pendientes hasta que Dirección apruebe en **12 · Equipo y accesos**.
- `api/r4.js` añade `actor {email, rol, via}` desde la sesión firmada (nunca del cuerpo). `r4_api` relee el rol en `usuarios` en CADA petición: bloquear o cambiar rol aplica al instante (401 `auth:false` → la plataforma borra la cookie y vuelve al portal).
- Permisos en Postgres: `set_config` y `usuario_set` solo Dirección; ediciones de CRM/Bandeja solo Dirección/Técnico/Comercial; Administración y Colaborador = lectura. Nadie cambia su propio acceso.
- `R4_PANEL_PASSWORD` (opcional) = acceso de emergencia de Dirección (`via: password`). Sin actor (`email` vacío y sin `via:password`) → `auth:false`: nada entra como Dirección por defecto.
- OAuth con `state` + **PKCE S256** (cookie `r4_oauth_state` = `state.verifier`, Path=/api/auth, 10 min). La sesión se firma con el email que verificó Google y debe coincidir con el que devuelve la BD.
- `GET /api/r4` solo hace `summary`; todo lo que escribe va por POST con comprobación de origen.
- Roles no Dirección reciben `summary` filtrado: sin eventos `usuario:*` y con `evolution_url`/`wa_destino_direccion` enmascarados.
- `R4_SESSION_SECRET` (recomendado, ≥ 32 aleatorios) firma las sesiones sin depender de `R4_API_KEY`.
- Variables Vercel: `R4_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `R4_DIRECCION_EMAILS`, `R4_SESSION_SECRET`, opcionales `R4_PANEL_PASSWORD`, `R4_PUBLIC_URL` (fijarla en producción), `N8N_API_URL`.
- Cliente OAuth GCP «R4 · Plataforma (login Google)» con redirect `https://r4-eight-rosy.vercel.app/api/auth/callback`. Si la app de Google está en «Prueba», solo entran los usuarios de prueba.

## Stack

| Capa | Tecnología | Dónde |
|---|---|---|
| Front | HTML + CSS + JS sin framework (`public/`) | Vercel `aresiaagency/r4` |
| API | Funciones Node 20+ de Vercel (`api/`, `lib/`) sin dependencias | Vercel |
| Orquestación | n8n 2.29 (`n8n/*.json` generados) | EasyPanel `r4-n8n.7dklrk.easypanel.host` |
| Datos | PostgreSQL (`db/schema.sql`) | EasyPanel proyecto `r4`, servicio `postgres` |
| Buffer WA | Redis (lo usa ATLASR4) | EasyPanel servicio `redis` |
| IA | OpenAI `gpt-4o-mini` (credencial n8n «OpenAI account») | n8n |
| WhatsApp | Evolution API v2 (`/message/sendText/{instancia}`) | Lo configura RHC |
| Gmail | OAuth2, proyecto GCP `r4-estructuras` (Gmail API habilitada) | Cuenta nueva pendiente |

## Interfaz · Holocontrol (v1.2)

- Lenguaje visual de **Ágora Hispana**: noche azul `#020b18`, cristal tallado con esquinas cortadas (`clip-path`), filo de **plasma vivo** (`conic-gradient` con `@property --ang` animado al tocar), cian `#4fd8ff` + verde R4 `#00ff7f`, rejilla de 44 px.
- Orden **tipo Apple**: barra de secciones → lista → ficha (Contactos), segmentos (Contactos · Embudo · Inmuebles), acciones rápidas redondas, objetivos táctiles ≥ 48 px, tilde de pulsación.
- Portal **«Elige tu acceso»** (01 Dirección · 02 Equipo · 03 Clientes) con **Entrar con Google**, mensajes `?acceso=`, punto de información (i) por sección, **Atrás** y **Salir** en cada pantalla.
- Acciones destructivas (rechazar, retirar acceso) con **confirmación de dos toques**, nunca `window.confirm` (bloquea la pantalla y la automatización).
- `public/guia.js` + `guia.css` = Guía de implantación (independiente de app.js: DOM, `location.hash` y `/api/*`). Pasos en el array `STEPS` (con `auto(summary)` para comprobarse solos) y cálculos en `calculos()`. Estado en `localStorage['r4:guia']`.
- `public/app.css` = estructura base; `public/holo.css` = piel Holocontrol (se carga después y no cambia el marcado). Respetar `prefers-reduced-motion`.

## Comandos clave

```bash
npm test                      # pruebas sin red: sesión, CSRF, lista blanca, coherencia de flujos, schema
npm run build:n8n             # regenera n8n/R4_*.json desde db/schema.sql y n8n/eco-prompt.mjs
npm run eval                  # OPENAI_API_KEY=… evalúa ECO con eval/eco-extraccion.jsonl (umbral 90 %)
npm run dev                   # servidor local tipo Vercel (R4_API_KEY, N8N_API_URL y GOOGLE_* o R4_PANEL_PASSWORD; MOCK_GOOGLE=1 simula Google)
PGDATABASE=r4test npm run eval:acceso   # matriz de permisos por rol (eval/acceso-roles.jsonl, 27 casos)
node scripts/mock-n8n.mjs     # doble local de «R4 · API» contra Postgres local (PGDATABASE)
npm run verify                # VERIFIER: Playwright, capturas en screenshots/ + verify-report.json
# login Google simulado: dev-server con MOCK_GOOGLE=1 + R4_MOCK_GOOGLE=1 VERIFY_DIRECCION=<email de R4_DIRECCION_EMAILS> npm run verify
psql -d r4test -f db/schema.sql && psql -d r4test -f db/test_flow.sql   # prueba E2E de las funciones SQL
```

## Estilo de código

- Español en UI, comentarios, nombres de negocio (`oportunidades`, `mensajes`) y mensajes de error.
- Sin dependencias en runtime. ES modules. Funciones pequeñas y puras donde se pueda (`buildPayload`).
- Front: todo texto dinámico pasa por `esc()`/`e2()`. Nada de `innerHTML` con datos sin escapar.
- SQL: idempotente (`IF NOT EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT`). Funciones con UN parámetro `jsonb`.
- **Nunca** escribir dólar+número en `db/schema.sql` (ni en comentarios): n8n usa pg-promise y lo toma como parámetro.
- Los JSON de `n8n/` NO se editan a mano: se editan `scripts/build-n8n.mjs`, `db/schema.sql` o `n8n/eco-prompt.mjs` y se regenera.
- El prompt de ECO tiene versión (`ECO_VERSION`). Cambiarlo = subir versión + `npm run eval`.

## Archivos prohibidos

- `.env*`, credenciales, apikeys de Evolution/OpenAI, contraseñas de Postgres → nunca en git ni en `r4_config`.
- La apikey de Evolution vive SOLO en la credencial n8n «Evolution API R4». `R4_API_KEY` SOLO en Vercel y en la credencial n8n «R4 API key».
- `GOOGLE_CLIENT_SECRET` SOLO en Vercel (lo escribe RHC). El `GOOGLE_CLIENT_ID` es público.
- Nunca aceptar el actor (email/rol) desde el cuerpo de la petición: solo desde la cookie firmada.
- No tocar el flujo original `ATLASR4` (id `Pu9Whh6Pm28EdzbB`) sin exportar antes una copia.
- `db/seed_demo.sql` y `db/test_flow.sql` NUNCA contra la BD de producción.

## Reglas de revisión (antes de dar algo por hecho)

1. `npm test` en verde y `npm run build:n8n` sin diff pendiente.
2. Cambios SQL: `schema.sql` dos veces seguidas (idempotencia) + `test_flow.sql` sin errores en BD local.
3. Cambios de UI: `npm run verify` con capturas revisadas (escritorio y móvil). Un log no basta.
4. Cambios en ECO: `npm run eval` ≥ 90 % y cada fallo real nuevo añadido a `eval/eco-extraccion.jsonl`.
5. Maker ≠ Verifier: quien hace el cambio no lo aprueba (ver `.claude/agents/`).
6. Nada de datos de clientes reales en capturas, issues o commits.

## Agentes y modelos

| Rol | Archivo | Modelo |
|---|---|---|
| Planificación multi-día | — | Fable 5 |
| Maker (ediciones, refactors masivos) | `.claude/agents/maker.md` | Sonnet 4.6 |
| Verifier (tests, app, capturas, logs) | `.claude/agents/verifier.md` | Sonnet 4.6 |
| Grading de evals | `scripts/run-evals.mjs` | Haiku 4.5 / determinista |
| Casos complejos o fallback | — | Opus |

Ejecuciones paralelas: un `git worktree` por agente (`git worktree add ../r4-<tarea> -b <tarea>`). Sin checkout compartido.

## Skills del repo (`.claude/skills/`)

- `n8n-triage` · diagnóstico de un fallo en ECO / R4 · API / ATLASR4.
- Migraciones en producción: editar `db/schema.sql` (idempotente) → actualizar la query del flujo «R4 · Setup DB» → ejecutarlo → correr «R4 · prueba ECO (borrar)», que prueba y limpia.
- ⚠️ Al editar SQL desde JS, usar `str.replace(a, () => b)`: con `replace(a, b)` los `$'` del SQL se expanden y corrompen la query.
- `deploy-check` · comprobación de un despliegue de Vercel + n8n.
- `eco-eval` · añadir un caso real y re-evaluar ECO.

## Routines (automatizaciones previstas)

| Disparador | Acción |
|---|---|
| Ejecución fallida en n8n (Error Workflow) | `n8n-triage` → aviso WhatsApp a A.R.E.S. |
| PR abierta en GitHub | Verifier: `npm test` + `npm run verify` sobre el preview de Vercel |
| 07:00 Europe/Madrid | Digest a Dirección: mensajes de ayer, clientes nuevos, avisos fallidos |
| Domingo 20:00 | `npm run eval` con los casos nuevos de la semana |
