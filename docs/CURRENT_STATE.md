# CURRENT_STATE.md — 2026-10-13 (después de Sprint 0)

## Implementado en el repositorio
- Workspace pnpm mínimo con `apps/web`, React, Vite y TypeScript estricto.
- Shell responsive de identidad provisoria que comunica: “Prototipo en desarrollo: reservas todavía no disponibles.” No presenta acciones operativas.
- PWA base: manifest, icono SVG, metadatos y service worker generado en build. No hay sincronización offline ni acceso a datos privados.
- Scripts reproducibles de desarrollo, typecheck, lint, test y build; prueba mínima de la comunicación de estado.
- `.gitignore`, `.env.example` sin valores y README de instalación local.

## Verificado localmente
- `pnpm typecheck` finaliza correctamente.
- `pnpm lint` finaliza correctamente.
- `pnpm test` finaliza correctamente (1 prueba).
- `pnpm build` finaliza correctamente y genera `manifest.webmanifest`, `sw.js` y los artefactos estáticos en `apps/web/dist`.
- `pnpm dev -- --host 127.0.0.1` inicia Vite localmente; no se realizó navegación ni prueba visual automatizada.

## No implementado
- Supabase, autenticación, schema, migraciones, RLS, seed, calendario, reservas, pagos, gestión de personas y despliegue.
- No se inicializó ni verificó un repositorio Git/GitHub remoto desde este paquete.

## Requiere verificación manual
- Instalación PWA en navegador compatible, comportamiento del service worker y visualización en teléfono físico.
- Existencia/configuración de cuenta Supabase, proyecto Vercel, repo privado GitHub y nombres/horarios reales de canchas.

## Remoto / producción
- Migraciones versionadas: **no incluidas** en este paquete.
- Migraciones aplicadas en remoto: **ninguna verificada**.
- Configuración de variables en remoto: **no verificada**.
- Aplicación en producción: **no verificada**.

## Próximo trabajo
**Sprint 1 — autenticación administrativa y configuración inicial de las seis canchas**, después de definir un procedimiento seguro de primer admin y crear Supabase en una región adecuada. No iniciar sin esas decisiones.

El agente debe **actualizar este documento según evidencias del repositorio** después del sprint, sin convertir aspiraciones en funcionalidades implementadas.
