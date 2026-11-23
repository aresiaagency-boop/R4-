# Especificación funcional · R4

Fuente: **R4 · Propuesta de desarrollo de la plataforma** (23 nov 2026) — [`R4_Propuesta_de_desarrollo.pdf`](R4_Propuesta_de_desarrollo.pdf) · doc vivo: https://claude.ai/artifact/6FVCGuwacQZnSRMGuT43Cm
Este archivo resume lo que el código debe cumplir y dónde está implementado. Si la propuesta cambia, se actualiza aquí primero.

## Principios
1. **WhatsApp es la puerta de entrada de datos** (clientes, encargados, Dirección → ATLAS).
2. **Facturación con Verifactu marca el orden** (fecha legal 1 ene 2027 si R4 es sociedad).
3. **La IA prepara; una persona de R4 decide.** EUNOMÍA es determinista: la IA nunca numera, calcula impuestos ni envía a la AEAT.
4. Nada sale de la plataforma sin pasar por la base de datos; nada económico sale sin aprobación humana.

## Módulos → fase → estado en el repo

| Módulo | Agente | Fase | Estado v1 | Dónde |
|---|---|---|---|---|
| CRM (contacto, organización, inmueble, oportunidad, actividad) | ATLAS · ECO | 2 | **Hecho (núcleo)** | `db/schema.sql` (clientes, organizaciones, inmuebles, oportunidades, mensajes, eventos) · vista 01 |
| Gmail → resumen → WhatsApp | ECO | 2 | **Hecho, probado en n8n** | `n8n/R4_ECO_gmail.json`, `n8n/eco-prompt.mjs` · vista 02 |
| WhatsApp de clientes | ATLAS | 2 | Prompt R4 + registro de mensajes | `n8n/atlas-system-prompt.md` · ATLASR4 en n8n |
| Presupuestos (catálogo, descompuestos, versiones, firma) | DÉDALO | 3 | Prototipo (datos de ejemplo) | vista 03 |
| Costes por obra × periodo × partida | HEFESTO | 4 | Prototipo | vista 06 |
| Planning, cuadrillas, medios, plan de las 7:00 | KAIRÓS | 4 | Prototipo | vista 05 |
| Facturación Verifactu (con/sin VERI*FACTU, SII) | EUNOMÍA | 1 | Prototipo + interruptor | vistas 07 y 10 |
| Control financiero mensual | PLUTO | 5 | Prototipo | vista 08 |
| Hoja de ruta y datos pendientes | — | — | **Hecho** | vista 11 |

## Reglas del CRM implementadas
- Deduplicación por email y teléfono antes de crear contacto (`r4_aplicar_extraccion`).
- Organización por nombre (no se crea para «Particular»); tipo según ECO.
- Inmueble por dirección + municipio; la oportunidad queda enlazada a su inmueble.
- **Alerta IEE** (`r4_alerta_iee`): más de 50 años sin IEE → `sin_iee`; IEE con ≥ 9,5 años → `renovar`.
- Etapas: Nuevo → Contactado → Visita de diagnóstico → Presupuesto enviado → Aceptado | **Perdido con motivo**.
- Base legal RGPD por contacto (`clientes.base_legal`, por defecto medidas precontractuales).

## Pendiente del CRM (siguiente iteración de la fase 2)
- Formulario web «pide diagnóstico» que entre directo al CRM.
- Exportar / borrar datos personales a petición (RGPD).
- Etiquetar en Gmail «R4/Ignorado» los correos que ECO descarta.
- Acceso del equipo con Google (hoy: contraseña de Dirección).

## Hoja de ruta (propuesta)

| Fase | Fechas |
|---|---|
| 0 · Base técnica | 30 nov – 11 dic 2026 |
| 1 · Facturación | 1 – 23 dic 2026 · Verifactu obligatorio 1 ene 2027 |
| 2 · CRM y Gmail | 14 dic 2026 – 15 ene 2027 (adelantada: v1 en marcha) |
| 3 · Presupuestos | 11 ene – 5 feb 2027 |
| 4 · Planning y costes | 1 feb – 12 mar 2027 |
| 5 · Control financiero | 8 – 31 mar 2027 · primer cierre 5 abr |

Si R4 es autónomo o se publica el aplazamiento a 2028, CRM y Gmail van delante. Cada fase termina con R4 usándola en una obra real.

## Lo que falta de R4
Razón social, CIF y domicilio fiscal · forma jurídica · modo de facturación · certificado electrónico · series y último número · tarifas · significado de «rangos de tiempo» · equipo y teléfonos de encargados · número de WhatsApp del agente y cuenta Gmail · clientes, obras y proveedores para la carga inicial.
Decisiones abiertas: quién aprueba presupuestos y cierra el mes; si el cliente ve su diario fotográfico; IA Claude u OpenAI; acceso con Google.
