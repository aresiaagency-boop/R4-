# Plataforma R4 · v1

Gestión de **R4 Rehabilitación de Estructuras** con agentes de IA: **ECO** lee el Gmail de R4, extrae los datos de cada cliente, los guarda en Postgres y avisa por WhatsApp; **ATLAS** atiende el WhatsApp de clientes vía Evolution API. Desarrollado por A.R.E.S. I.A.

| Sección | v1 |
|---|---|
| 00 Mission Control · 01 CRM · 02 Bandeja · 09 ATLAS · 10 Configuración | **Datos reales** (Postgres vía n8n) |
| 03 Presupuestos · 04 Obras · 05 Planning · 06 Costes · 07 Facturación · 08 Finanzas | Ejemplo (fases 1, 3, 4 y 5) |
| 11 Hoja de ruta | Plan por fases y datos pendientes de R4 (Propuesta 23 nov) |

Especificación: [`docs/PROPUESTA.md`](docs/PROPUESTA.md).

Sin sesión, la plataforma funciona en **modo demostración** con datos de ejemplo.

**Guía de implantación (v1.3):** botón flotante **Guía ON/OFF** que acompaña paso a paso (20 pasos en 5 fases, de cero a piloto automático), ilumina en pantalla cada elemento que hay que tocar, comprueba sola los pasos con los datos reales y calcula fechas, horas de carga, coste de IA y ahorro (sección 12 · Implantación).

**Interfaz Holocontrol (v1.2):** portal «Elige tu acceso» como Ágora Hispana, paneles de cristal con filo de plasma, CRM táctil en orden Apple (Contactos → ficha con acciones rápidas, Embudo arrastrable con el dedo, Inmuebles con alerta IEE), Mission Control simétrico con las conexiones en tiempo real, punto de información, Atrás y Salir en cada pantalla.

## Puesta en marcha (una vez)

### 1. Postgres (vía n8n)
1. n8n → *Import from file* → `n8n/R4_setup_db.json` → **Execute workflow**. Crea tablas y funciones `r4_*` (idempotente; repetir tras cada cambio de `db/schema.sql`).

### 2. API de la plataforma
1. Generar un secreto largo (p. ej. `openssl rand -hex 32`).
2. n8n → Credentials → *Header Auth* «**R4 API key**»: Name `x-r4-key`, Value = el secreto.
3. Importar `n8n/R4_API.json`, asignar «R4 API key» al Webhook y «Evolution API R4» al nodo Evolution → **Publish**.
4. Vercel → `r4` → Settings → Environment Variables (Production + Preview):
   - `R4_API_KEY` = el mismo secreto del paso 1
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` = cliente OAuth web «R4 · Plataforma (login Google)» del proyecto GCP `r4-estructuras`, con URI de redirección `https://<dominio>/api/auth/callback`
   - `R4_DIRECCION_EMAILS` = cuentas de Google de Dirección, separadas por coma (siempre entran como Dirección)
   - (opcional) `R4_PANEL_PASSWORD` = acceso de emergencia de Dirección (mín. 8)
   - (opcional) `N8N_API_URL` = `https://r4-n8n.7dklrk.easypanel.host/webhook/r4-api`
5. Redeploy. Entrar en la plataforma → **01 · Dirección → Entrar con Google**.
6. Equipo: cada persona pulsa **02 · Equipo → Entrar con Google**; queda pendiente y Dirección la aprueba con su rol en **12 · Equipo y accesos**. «Retirar acceso» la saca en su siguiente acción.

### 3. Gmail (cuenta nueva de R4) → ECO
1. GCP `r4-estructuras` → Google Auth Platform → **Clientes** → *Aplicación web*. URI de redirección: `https://r4-n8n.7dklrk.easypanel.host/rest/oauth2-credential/callback`.
2. *Público* → añadir la cuenta Gmail nueva como **usuario de prueba** (o publicar la app para evitar que el token caduque a los 7 días).
3. n8n → credencial *Gmail OAuth2* con ese Client ID/Secret → *Sign in with Google* con la cuenta nueva.
4. Importar `n8n/R4_ECO_gmail.json`, asignar la credencial Gmail y «Evolution API R4» → **Publish**.

### 4. WhatsApp (Evolution API)
1. Crear la instancia y vincular el número (lo configura RHC).
2. n8n → credencial *Header Auth* «**Evolution API R4**»: Name `apikey`, Value = apikey de la instancia.
3. Evolution → webhook de la instancia → `https://r4-n8n.7dklrk.easypanel.host/webhook/atlasr4` (evento `MESSAGES_UPSERT`).
4. Plataforma → **10 Configuración** → URL de Evolution, instancia, WhatsApp de Dirección y campos a enviar → *Guardar ajustes*.
5. ATLASR4 → pegar `n8n/atlas-system-prompt.md` como *System Message* del AI Agent.

## Flujo ECO

`Gmail (cada minuto)` → `Normalizar correo` → `r4_ingest` (deduplica) → `OpenAI JSON estricto` → `r4_aplicar_extraccion` (cliente + oportunidad + evento) → `Evolution sendText` a Dirección → `r4_marcar_wa`.

Aviso que recibe Dirección:
```
*NUEVO CORREO DE CLIENTE · R4* 🔴 URGENTE
*Nombre:* Carmen Vidal
*Empresa:* Administración de Fincas Portixol
*Email:* c.vidal@fincas-portixol.example
*Teléfono:* +34600000101
*Servicio:* Reparación del hormigón armado
*Urgencia:* alta
*Resumen:* Grietas en dos vigas del garaje. Pide visita esta semana…
_Mensaje #1 · oportunidad #1_
```

## Desarrollo

Ver `CLAUDE.md` (stack, comandos, reglas) y `MEMORY.md` (estado y próximos pasos).
