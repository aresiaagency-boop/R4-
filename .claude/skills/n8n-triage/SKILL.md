---
name: n8n-triage
description: Diagnostica un fallo en los flujos n8n de R4 (ECO Gmail, R4 · API, ATLASR4) y propone el arreglo mínimo. Usar cuando una ejecución falla, no llegan avisos de WhatsApp o la plataforma muestra «Sin conexión».
---

# Triage de n8n · R4

1. **Síntoma → flujo**
   - Plataforma «Sin conexión» / 502 → `R4 · API`.
   - Correos que no aparecen en Bandeja → `R4 · ECO` (trigger Gmail).
   - Aparecen pero sin aviso WhatsApp (estado `procesado` o `error_wa`) → nodo «Evolution · enviar aviso».
   - Clientes de WhatsApp sin respuesta → `ATLASR4`.
2. **Mirar la última ejecución** en n8n → Executions del flujo. Anotar el nodo en rojo y el mensaje.
3. **Tabla de causas conocidas**

| Error | Causa | Arreglo |
|---|---|---|
| 404 en `/webhook/r4-api` | Flujo no publicado | Publicar «R4 · API» |
| 403 «Authorization data is wrong» | `R4_API_KEY` ≠ credencial «R4 API key» | Igualar valores (Vercel + n8n) |
| `function r4_… does not exist` | Esquema no instalado | Ejecutar «R4 · Setup DB» |
| `Variable $N out of range` | Se coló dólar+número en `schema.sql` | `npm test` lo detecta; quitarlo y regenerar |
| Evolution 401 | apikey errónea | Credencial «Evolution API R4» (Name `apikey`) |
| Evolution 404 / instance not found | Nombre de instancia | Configuración → Instancia |
| Gmail `invalid_grant` | Token caducado (app en «Prueba» caduca a 7 días) | Reconectar credencial o publicar la app OAuth |
| OpenAI 429 | Cuota | Revisar facturación OpenAI; el nodo reintenta 3 veces |

4. **Reproducir en local** si es lógica SQL: `psql -d r4test -f db/schema.sql && psql -d r4test -f db/test_flow.sql`.
5. **Cerrar**: anotar en `MEMORY.md` → «Intentos fallidos» o «Hechos verificados». Si fue un correo mal clasificado → skill `eco-eval`.
