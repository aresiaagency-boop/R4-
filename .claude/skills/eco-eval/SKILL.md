---
name: eco-eval
description: Convierte un correo que ECO clasificó o extrajo mal en un caso de evaluación y mide el prompt. Usar cuando Dirección corrige datos en la Bandeja o marca un mensaje como cliente/no cliente.
---

# Evaluación de ECO

1. Localizar el mensaje en la plataforma (Bandeja, nº de mensaje) y copiar remitente, asunto y cuerpo **anonimizados** (sustituir nombres, emails y teléfonos reales por equivalentes `.example`).
2. Añadir una línea a `eval/eco-extraccion.jsonl`:
   `{"id":"<tipo>-<resumen>","input":{...},"expect":{"es_cliente":true,"urgencia":"alta","municipio_contiene":"Palma"}}`
   Claves de `expect`: igualdad exacta, o `<campo>_contiene` para subcadenas sin tildes.
3. `OPENAI_API_KEY=… npm run eval` con el prompt actual → confirmar que el caso falla.
4. Ajustar `n8n/eco-prompt.mjs` (subir `ECO_VERSION`), volver a evaluar hasta ≥ 90 % sin romper casos previos.
5. `npm run build:n8n` → reimportar `n8n/R4_ECO_gmail.json` en n8n (o pegar el nodo «Preparar petición IA»).
6. Anotar en `MEMORY.md` la versión y la puntuación.
