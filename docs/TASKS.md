# TASKS.md — pendientes activos (no historial)

## Prioridad P0
- [ ] Crear repo privado GitHub y confirmar quién es dueño y quién tiene acceso.
- [x] Sprint 0: scaffold pnpm/React/Vite/TS/PWA + calidad y docs (validación de comandos pendiente de registrar según ejecución real).
- [ ] Revisar con Rafa las **10 preguntas críticas** en `VALIDACION_RAFA.md` antes de automatizar restricciones del calendario.
- [ ] Acordar con Rafa titularidad de cuentas, costos de hosting/dominio y alcance del soporte.
- [ ] Configurar un proyecto Supabase en región adecuada y definir quién tendrá acceso administrativo.
- [x] Sprint 1: el usuario verificó manualmente acceso owner, seis canchas, edición y persistencia. Falta evidencia reproducible de RLS con múltiples usuarios.
- [ ] Aplicar en orden `20261013010000_reservations.sql`, `20261013020000_blocks_and_recurring_reservations.sql` y `20261013030000_club_people_and_memberships.sql`; confirmar el estado remoto antes de hacerlo.
- [ ] Ejecutar `supabase/verification/rls-checks.sql` y `supabase/verification/sprint-03-blocks-and-series-checks.sql` con usuarios reales de dos clubes; registrar RLS, solapes cruzados, cancelación, contigüidad, atomicidad y concurrencia.
- [ ] Validar manualmente el calendario Sprint 3 contra Supabase desde escritorio y celular: bloqueo, motivo, conflicto reserva↔bloqueo, serie semanal y edición/cancelación individual.
- [ ] Ejecutar `supabase/verification/sprint-04-people-and-memberships-checks.sql` y validar Sprint 4 desde escritorio y celular: alta/edición/baja lógica, búsqueda, membresía por rol, aislamiento y reserva con nombre libre o ficha vinculada.

## P1/P2 (no tomar ahora)
- [ ] Acordar reglas de cuotas, profesores, torneos y cantina cuando llegue su sprint.
- [ ] Revisar política de backup/restore y operación si no hay conexión antes del piloto.

## Riesgos
- Cambiar el alcance al desarrollar (añadir POS, cobros, torneos prematuramente).
- Tomar precios/horarios de ejemplo como confirmados.
- Migración versionada sin aplicar, o aplicada manualmente sin reflejar estado documental.
- Declarar verificada la exclusión temporal o RLS de reservas sin probarlas en PostgreSQL/Supabase real.
- Confundir PWA instalable con POS offline-first.
