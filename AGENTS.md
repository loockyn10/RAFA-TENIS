# AGENTS.md — reglas para agentes de implementación

Trabajamos en **Rafa Tenis**. Antes de cambiar código:
1. Leer este archivo, `AI_WORKFLOW.md` y `docs/PROJECT_CONTEXT.md`.
2. Leer solo documentación pertinente en `docs/` (`PRODUCT`, `ARCHITECTURE`, `CURRENT_STATE`, `ROADMAP`, `DECISIONS`, `TASKS`, `VALIDACION_RAFA`).
3. Inspeccionar `git status`, estructura real, archivos y tests directamente relacionados. No asumir nombres de carpetas ni tablas.
4. Si código y documentación se contradicen: **informar contradicción**, no sobrescribir silenciosamente.

## Invariantes
- La app **se adapta al club**: carga rápida, operaciones informales y sin obligación de registrar cobros inmediatamente.
- Ficha de jugador ≠ usuario Supabase Auth: alguien puede tener turnos sin iniciar sesión.
- Un calendario único de ocupación por cancha sirve para juego, clases, torneos y mantenimiento (cuando existan).
- Separar **reserva**, **uso efectivo** y **cargo/pago**; nunca derivar automáticamente una deuda solo de la duración reservada.
- Evitar solapes en PostgreSQL, no solo en UI; respetar turnos contiguos.
- Aislar datos privados por club/roles mediante backend y RLS. No exponer claves secretas al cliente ni hacer autoprovisión de admin público.
- No asumir tarifas, apertura/cierre, franja de reservas, consecuencias de cancelación ni suspensión automática por cuotas impagas.
- Mostrar hora local del club: `America/Argentina/Buenos_Aires`; almacenar fechas/horas de reservaciones como `timestamptz` cuando exista schema.

## Stack previsto
pnpm + React/Vite/TypeScript + PWA responsive + Supabase/PostgreSQL/Auth/RLS + Vercel + GitHub. Sin Docker ni Tauri. Sin librerías/paquetes compartidos prematuros.

## Entregables por sprint
- Cambios acotados al sprint; no incorporar mejoras ajenas por iniciativa propia.
- Ejecutar tests, lint, typecheck y build disponibles; decir cuáles pasaron y cuáles no se ejecutaron.
- Actualizar **solo** docs que cambien materialmente, en especial `CURRENT_STATE.md` y `TASKS.md`.
- Distinguir: archivos en repositorio / migraciones aplicadas en remoto / funcionalidad verificada manualmente.
- SQL remoto, migraciones aplicadas, secretos, `commit`, `push` o `merge`: requieren autorización explícita del usuario.
- No inventar resultados de tests ni despliegues. Cerrar cada sprint con resumen breve, limitaciones reales y siguiente paso.
