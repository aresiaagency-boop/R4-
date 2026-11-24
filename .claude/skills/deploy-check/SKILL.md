---
name: deploy-check
description: Comprueba un despliegue de la plataforma R4 (Vercel + n8n + Postgres) con evidencia visual. Usar tras cada push a main, tras cambiar variables de Vercel o al publicar flujos en n8n.
---

# Comprobación de despliegue · R4

1. Vercel → proyecto `r4` → último deployment en estado **Ready**. Anotar la URL.
2. `curl -s https://<url>/api/session` → `{"configured":true,...}`. Si `false`: faltan `R4_PANEL_PASSWORD` / `R4_API_KEY` (y redeploy).
3. `R4_URL=https://<url> R4_PANEL_PASSWORD=… npm run verify` → todas las comprobaciones en verde.
4. Revisar las capturas de `screenshots/` (escritorio y móvil): pill «En vivo», Bandeja con mensajes, Configuración → Integraciones.
5. n8n: «R4 · API» y «R4 · ECO» publicados (toggle activo). Última ejecución de ECO sin errores.
6. Resultado → `MEMORY.md` («Última sesión»): URL, hora, n.º de comprobaciones, incidencias.
