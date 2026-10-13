# TASKS.md — pendientes activos (no historial)

## Prioridad P0
- [ ] Crear repo privado GitHub y confirmar quién es dueño y quién tiene acceso.
- [x] Sprint 0: scaffold pnpm/React/Vite/TS/PWA + calidad y docs (validación de comandos pendiente de registrar según ejecución real).
- [ ] Revisar con Rafa las **10 preguntas críticas** en `VALIDACION_RAFA.md` antes de automatizar restricciones del calendario.
- [ ] Acordar con Rafa titularidad de cuentas, costos de hosting/dominio y alcance del soporte.
- [ ] Configurar un proyecto Supabase en región adecuada y definir quién tendrá acceso administrativo.
- [x] Sprint 1: el usuario verificó manualmente acceso owner, seis canchas, edición y persistencia. Falta evidencia reproducible de RLS con múltiples usuarios.
- [ ] Confirmar en el historial remoto las migraciones Sprint 2–5 que el usuario informó operativas; aplicar después `20261013050000_tennis_school.sql`. No reaplicar ni editar migraciones históricas.
- [ ] Ejecutar `supabase/verification/rls-checks.sql` y `supabase/verification/sprint-03-blocks-and-series-checks.sql` con usuarios reales de dos clubes; registrar RLS, solapes cruzados, cancelación, contigüidad, atomicidad y concurrencia.
- [ ] Validar manualmente el calendario Sprint 3 contra Supabase desde escritorio y celular: bloqueo, motivo, conflicto reserva↔bloqueo, serie semanal y edición/cancelación individual.
- [ ] Ejecutar `supabase/verification/sprint-04-people-and-memberships-checks.sql` y validar Sprint 4 desde escritorio y celular: alta/edición/baja lógica, búsqueda, membresía por rol, aislamiento y reserva con nombre libre o ficha vinculada.
- [ ] Ejecutar `supabase/verification/sprint-05-membership-dues-and-payments-checks.sql` y validar Sprint 5 desde escritorio y celular: configuración, generación idempotente, cuota individual, pagos parciales, sobrepago, anulación, RLS y concurrencia.
- [ ] Ejecutar `supabase/verification/sprint-06-tennis-school-checks.sql` y validar Sprint 6 desde escritorio y celular: profesor, alumnos, cupos, agenda compartida, recurrencia, cancelación, aislamiento y roles.
- [ ] Confirmar el historial remoto de Sprint 6 indicado como pendiente en esta documentación antes de aplicar `20261013060000_tournaments.sql`; no reaplicar migraciones históricas.
- [ ] Ejecutar `supabase/verification/sprint-07-tournaments-checks.sql` con usuarios de dos clubes: fixture 4/6/8, BYE, duplicados, avances, W.O., campeón, permisos y choques partido↔reserva/clase/bloqueo.
- [ ] **Bug Sprint 07:** al generar fixture en el entorno desplegado se informa `new row for relation "tournament_matches" violates check constraint "tournament_matches_next_target"`. Investigar/corregir en etapa de bugs; no considerar generación de fixture verificada.
- [ ] Aplicar manualmente `20261013070000_canteen.sql` solo después de confirmar el historial remoto de migraciones anteriores; no editar ni reaplicar migraciones históricas.
- [ ] Ejecutar `supabase/verification/sprint-08-canteen-checks.sql` con owner/admin, staff y dos clubes: catálogo, ventas inmediata/pendiente, precio histórico, pagos parciales, idempotencia, anulación, RLS y concurrencia.

## P1/P2 (no tomar ahora)
- [ ] Confirmar con Rafa importe inicial, día de vencimiento y criterio operativo de emisión mensual antes de habilitar cuotas en el club.
- [ ] Acordar reglas de profesores, torneos y cantina cuando llegue su sprint.
- [ ] Revisar política de backup/restore y operación si no hay conexión antes del piloto.

## Riesgos
- Cambiar el alcance al desarrollar (añadir POS, cobros, torneos prematuramente).
- Tomar precios/horarios de ejemplo como confirmados.
- Migración versionada sin aplicar, o aplicada manualmente sin reflejar estado documental.
- Declarar verificada la exclusión temporal o RLS de reservas sin probarlas en PostgreSQL/Supabase real.
- Confundir PWA instalable con POS offline-first.
