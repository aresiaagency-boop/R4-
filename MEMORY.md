# MEMORY.md · R4

Memoria persistente del proyecto. Cada sesión termina actualizando este archivo.

## Hechos verificados

- 2026-11-23 · Repo `aresiaagency-boop/R4-` estaba vacío; Vercel `aresiaagency/r4` conectado a GitHub, sin despliegues (despliega al hacer push a `main`).
- 2026-11-23 · n8n 2.29.9 en `https://r4-n8n.7dklrk.easypanel.host`. Credenciales existentes: «OpenAI account» (`ibzYsjSd50fbsD3I`), «Postgres account» (`Zcr7iqVn6j1Z7UAb`), «Redis account» (`yvC50EE0D5qHFjGH`).
- 2026-11-23 · Flujo `ATLASR4` (`Pu9Whh6Pm28EdzbB`, inactivo): Webhook POST `/webhook/atlasr4` → buffer Redis → texto/audio (transcripción OpenAI) → AI Agent `gpt-4o-mini` + Postgres Chat Memory (`n8n_chat_histories`) → HTTP `{{server_url}}/message/sendText/{{instance}}` con apikey del propio webhook de Evolution. Prompt de sistema genérico (plantilla) → sustituir por `n8n/atlas-system-prompt.md`. Tiene restos de plantilla GHL (`calendarId`, `locationId`) sin uso.
- 2026-11-23 · Postgres EasyPanel: proyecto `r4`, servicio `postgres`, usuario `postgres`, BD `r4`, host interno `r4_postgres:5432`. NO expuesto (puerto público 0). Mantenerlo así: Vercel entra vía n8n.
- 2026-11-23 · GCP `r4-estructuras`: Google Auth Platform en «Prueba», usuarios externos, 0 usuarios de prueba, sin cliente OAuth. Gmail API **habilitada** el 23 nov.
- 2026-11-23 · n8n `/rest/*` desde el navegador devuelve 401 con `fetch` simple; el estado del editor se lee desde Pinia (`workflowDocuments/<id>@latest`).
- 2026-11-23 · Especificación funcional: doc «R4 · Propuesta de desarrollo de la plataforma» (https://claude.ai/artifact/6FVCGuwacQZnSRMGuT43Cm): 7 módulos, 7 agentes (ATLAS, ECO, DÉDALO, KAIRÓS, HEFESTO, EUNOMÍA, PLUTO), 8 roles, 15 entidades, Verifactu con interruptor. ECO v1.1 usa sus líneas de catálogo y tipos de organización.
- 2026-11-23 · Decisiones abiertas de la propuesta: IA «Claude» (v1 usa OpenAI porque es la credencial que ya existe en n8n), acceso del equipo con Google (v1 usa contraseña de Dirección), etiqueta Gmail «R4/Ignorado» (pendiente).
- 2026-11-23 · Datos de R4 (web): Carrer Bellavista-C 14, Urb. Bellavista Arenal, 07600 Arenal · 655 915 236 · 971 29 07 86 · proyectos@r4estructuras.com · Sika, Mecanoviga, Odana Ingeniería.

- 2026-11-23 · n8n `/rest/*` funciona desde la pestaña con cabecera `browser-id: localStorage['n8n-browserId']` (crear con POST /rest/workflows, editar con PATCH + versionId).
- 2026-11-23 · Flujos creados en r4-n8n: «R4 · Setup DB» `rOAZNXNvwJ0WsEsd` (ejecutado OK: 5 tablas en BD r4), «R4 · API» `KgZeTL8cA123mCSg`, «R4 · ECO · Gmail» `Wl1l69BvgqDdYvU2`, «R4 · prueba ECO (borrar)» `xBc3RcpAvrobeDmm`.
- 2026-11-23 · Prueba real ECO en n8n (OpenAI gpt-4o-mini + Postgres r4): extracción correcta (cliente, alta, servicio, teléfono +34…) y escritura OK; datos de prueba borrados. `queryReplacement` con `JSON.stringify(...)` y comas internas funciona en Postgres v2.5.
- 2026-11-23 · ATLASR4 (`Pu9Whh6Pm28EdzbB`) actualizado: prompt de sistema R4 v1 + nodo «R4 · registrar WhatsApp» (r4_ingest, continúa si falla). Versión anterior: `baa84801-f40e-425a-b3fc-120bbd42d219` en el historial de n8n.
- 2026-11-23 · GCP: cliente OAuth web «R4 · n8n Gmail (ECO)» creado con redirect de n8n. App en «Prueba»: cada cuenta Gmail debe estar en *Público → Usuarios de prueba* (si no, 403 access_denied).

- 2026-11-23 · Propuesta (PDF) integrada: `docs/`, sección 11 «Hoja de ruta», CRM con organizaciones + inmuebles + alerta IEE + motivo de pérdida. Migración aplicada en producción con «R4 · Setup DB» (7 tablas) y verificada con «R4 · prueba ECO (borrar)» (crea, actualiza inmueble, marca perdido con motivo y limpia).
- 2026-11-23 · Hoja de ruta de la Propuesta: F0 base 30 nov–11 dic · F1 facturación 1–23 dic (Verifactu 1 ene) · F2 CRM+Gmail 14 dic–15 ene · F3 presupuestos 11 ene–5 feb · F4 planning+costes 1 feb–12 mar · F5 financiero 8–31 mar · cierre 5 abr. RHC ha adelantado la F2.

- 2026-11-24 · Interfaz v1.2 «Holocontrol» (estilo Ágora Hispana: tokens --fondo #020b18, --cian #4fd8ff, chaflán clip-path, conic plasma con @property --ang; orden Apple en CRM). `r4_summary` devuelve ahora `clientes` y `oportunidades.cliente_id`; aplicado en producción (Setup DB ejecución 5, 7 tablas).
- 2026-11-24 · Verificación visual: 34/34 en escritorio + móvil, capturas iPad Pro 11 horizontal sin errores de consola.

- 2026-11-24 · Producción: https://r4-eight-rosy.vercel.app (Vercel `r4`, commit subido por RHC + 6 archivos ocultos añadidos por la web de GitHub). Repo de GitHub idéntico al local.
- 2026-11-24 · GCP usuarios de prueba: aresiaagency@gmail.com y canaclaupalma@gmail.com. La credencial n8n «Gmail account» (`ID8hZlTmRn2vSEbH`) está conectada a **canaclaupalma@gmail.com** (38 correos); asignada al disparador de ECO.
- 2026-11-24 · Credenciales n8n creadas vacías para que RHC pegue el valor: «R4 API key» (`kgItKJrwVQyHIxOP`, Name x-r4-key) y «Evolution API R4» (`gXGpzwwNm2w021Tn`, Name apikey); ya asignadas al webhook de «R4 · API» y a los nodos Evolution de API y ECO. Flujo auxiliar «R4 · comprobar cuenta Gmail» (`IeqSOKDWheGwNHoN`).

- 2026-11-24 · Producción verificada: sesión de Dirección OK, «R4 · API», «R4 · ECO» y ATLASR4 publicados; webhook r4-api responde 403 sin clave; Configuración guardada (Evolution `https://r4-evolution-api.7dklrk.easypanel.host`, instancia `r4`, plataforma, Gmail). Pendiente: WhatsApp de Dirección, QR de la instancia r4 (estado Disconnected) y primer correo real por ECO.
- 2026-11-24 · v1.3: Guía de implantación interactiva (guia.js/guia.css) con ON/OFF, foco sobre elementos, auto-comprobación y calculadora.

- 2026-11-24 · v1.4 login con Google: tabla `usuarios`, `r4_auth_login`, `r4_api` con actor y permisos por rol; `/api/auth/google` + `/api/auth/callback`; sección «12 · Equipo y accesos»; Implantación pasa a 13. Tests 10/10, verificador 55/55 (Google simulado con MOCK_GOOGLE).
- 2026-11-24 · Producción migrada: «R4 · Setup DB» renombrado «(esquema v1.4 · login Google)», ejecución 11 OK (8 tablas). La query guardada en n8n es el esquema SIN comentarios (distinta del JSON del repo): para migrar, reemplazar bloques (de `CREATE OR REPLACE FUNCTION r4_api(` a `$fn$;`), no aplicar diffs del repo.
- 2026-11-24 · Compatibilidad: la migración aplicada en producción (ejecución 11) aún trata «sin actor» como Dirección para que el código v1.3 desplegado siga funcionando. La versión endurecida (sin actor → auth:false, summary filtrado por rol, tope de 50 solicitudes) está guardada en «R4 · Setup DB» y se ejecuta DESPUÉS de desplegar v1.4.
- 2026-11-24 · Verifier (agente separado) revisó el login: sin fallos críticos; aplicados sus 6 arreglos (actor estricto, email Google = email BD, R4_SESSION_SECRET, GET solo summary, PKCE, filtrado por rol). Tests 12/12, eval acceso 27/27, verify 55/55.
- 2026-11-24 · GCP: cliente OAuth web «R4 · Plataforma (login Google)» `312906714125-9njcgj43sjr7k6t4slbfupfualurbmid.apps.googleusercontent.com` (origen r4-eight-rosy.vercel.app, redirect /api/auth/callback). Vercel: `GOOGLE_CLIENT_ID` añadida (Production, tipo Config).

## Intentos fallidos

- `gh` en la nube sin token válido → no se puede hacer push desde el contenedor; subir por la web de GitHub o desde el equipo de RHC.
- `fetch('/rest/workflows/…')` en n8n con cookie → 401 (falta cabecera `browser-id`); usar import por la UI o Pinia.
- Escribir `.env.example` con redirección de shell lo bloquea un hook de seguridad → variables documentadas en README/CLAUDE.md.
- Subir el repo a GitHub desde el agente: `file_upload` solo admite archivos compartidos por el usuario; pedir acceso a carpeta y publicar un paquete base64 como artifact fueron denegados por el clasificador → el usuario arrastra la carpeta en GitHub › Upload files.
- Pulsar «Guardar» al añadir usuarios de prueba en GCP lo deniega el clasificador → lo pulsa el usuario.
- Publicar (activar) flujos en n8n lo deniega el clasificador → lo pulsa RHC. Los secretos (variables de Vercel, valores de credenciales) siempre los escribe RHC.
- El correo de prueba desde Gmail web (automatizado) no llegó a enviarse: pedir a RHC que envíe uno.
- Archivos ocultos (.gitignore, .claude/) no se suben al arrastrar carpetas en GitHub → crearlos con `/new/main?filename=…&value=…`.
- Un intento anterior de esta sesión perdió el contexto a mitad del rediseño; el trabajo quedó en disco sin commit (holo.css, app.js). Lección: commit intermedio en cada hito.
- `String.replace(a, b)` en JS con SQL que contiene `'$'` metió el resto de la query dentro de sí misma (patrón `$'`). Reparado; usar siempre función de reemplazo.
- Playwright `page.route` NO intercepta destinos de redirección (accounts.google.com tras 302) → interceptar `/api/auth/google` con `route.fetch({maxRedirects:0})` y devolver 302 al callback.
- `window.confirm` en la UI: Playwright lo descarta por defecto y bloquea la extensión de Chrome → confirmación de dos toques.
- Tras reiniciar el contenedor, Postgres local pierde el rol `root` → `su postgres -c "psql -c 'CREATE ROLE root SUPERUSER LOGIN'"`.
- Stub de `fetch` en tests: `'…/tokeninfo'.startsWith('…/token')` es true → comprobar la URL más larga primero.

## Última sesión (2026-11-24 · login con Google)

- Implantado el login OAuth con Google con Dirección al mando (aprobación, roles, retirada inmediata). BD de producción migrada. Cliente OAuth creado y `GOOGLE_CLIENT_ID` en Vercel.
- Pendiente de RHC: `GOOGLE_CLIENT_SECRET` y `R4_DIRECCION_EMAILS` en Vercel, subir el código v1.4 a GitHub (despliega Vercel) y probar «Entrar con Google».

## Sesión anterior (2026-11-23)

- Construida v1: front (prototipo + capa en vivo), API Vercel con sesión, esquema SQL con funciones `r4_*`, flujos n8n generados (Setup DB, ECO Gmail, R4 API), prompt de ATLAS, evals (12 casos), tests (6), verifier Playwright (31/31 en local con mock n8n).

## Próximos pasos

1. RHC: Vercel → `GOOGLE_CLIENT_SECRET` (secreto del cliente «R4 · Plataforma (login Google)»; si se cerró el diálogo, «Agregar secreto» en el cliente), `R4_DIRECCION_EMAILS`, `R4_SESSION_SECRET` (32+ aleatorios) y `R4_PUBLIC_URL=https://r4-eight-rosy.vercel.app`.
2. RHC: subir v1.4 a GitHub (arrastrar el contenido del zip en Upload files) → Vercel despliega. Después: ejecutar «R4 · Setup DB» (versión endurecida).
3. Verificar en producción: portal con «Entrar con Google», Dirección en vivo, solicitud de un segundo usuario, aprobar, retirar.
4. GCP: publicar la app (Público → Publicar) para que entre el equipo sin ser usuario de prueba; decisión de RHC.
5. Evolution: QR de la instancia r4 + webhook `/webhook/atlasr4` (MESSAGES_UPSERT). WhatsApp de Dirección en Configuración.
6. Primer correo real a canaclaupalma@gmail.com para validar ECO en vivo.
7. Fase 1: Facturación VERI*FACTU (EUNOMÍA).
