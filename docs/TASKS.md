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
- [ ] **Bug Sprint 07 (corregido en repositorio por Sprint 10A, NO resuelto en producción):** generar fixture fallaba con `tournament_matches_next_target` (23514). Causa reproducida: con exactamente 2 inscripciones el cuadro es una sola ronda y `generate_tournament_fixture` insertaba la final con `next_match_id = NULL` y `next_slot = 1`. Corrección en `supabase/migrations/20261014010000_fix_tournament_fixture.sql`. Pendiente: confirmar el historial remoto, aplicar esa migración, ejecutar `supabase/verification/sprint-10a-legacy-diagnostics.sql` (solo lectura) y recorrer un torneo completo (ver CURRENT_STATE). Recién entonces cerrar este ítem.
- [ ] Sprint 10A corrige en la misma migración dos defectos más de `record_tournament_match_result`: (a) aceptaba ganadores ajenos o partidos sin rival (comparación `NOT IN` con NULL); (b) rechazaba la ronda 1 si ya se había jugado una ronda 2 entre pases libres (cuadros con BYE quedaban bloqueados). Si el club ya cargó resultados con el código anterior, correr el diagnóstico de solo lectura; las constraints nuevas se agregan `NOT VALID` y se validan (`VALIDATE CONSTRAINT`) solo tras corregir las filas anómalas.
- [ ] Ejecutar `supabase/verification/run-sprint-10a-local.sh` (PostgreSQL local descartable) cada vez que cambie el fixture; pasó localmente en Sprint 10A. No sustituye la verificación en Supabase real con usuarios de dos clubes.
- [ ] (Hallazgo independiente, no tocado) Con los privilegios por defecto de Supabase, las RPC de otros módulos (cuotas, cantina, portal, series, etc.) conservan EXECUTE para `anon` porque sus migraciones solo hacen `revoke ... from public`. Cada RPC valida `auth.uid()` internamente, pero conviene una migración transversal que revoque explícitamente a `anon`. Sprint 10A lo hizo solo para las 9 RPC de torneos.
- [ ] (Hallazgo independiente, decisión de producto) Un torneo pasa a `completed` cuando terminan todas las categorías existentes, aunque luego se quisiera crear otra (queda cerrado). Confirmar con Rafa si debe cerrarse manualmente.
- [ ] (Menor) `tournament_entries.draw_position` nunca se completa al generar el fixture; el orden del sorteo solo se deduce de los partidos.
- [ ] Aplicar manualmente `20261013070000_canteen.sql` solo después de confirmar el historial remoto de migraciones anteriores; no editar ni reaplicar migraciones históricas.
- [ ] Ejecutar `supabase/verification/sprint-08-canteen-checks.sql` con owner/admin, staff y dos clubes: catálogo, ventas inmediata/pendiente, precio histórico, pagos parciales, idempotencia, anulación, RLS y concurrencia.
- [ ] Confirmar el historial remoto real de migraciones 01–08 antes de aplicar `20261013080000_player_portal.sql`; no reaplicar ni editar migraciones históricas.
- [ ] Ejecutar `supabase/verification/sprint-09-player-portal-checks.sql` con owner/admin, jugadores de dos clubes y cuenta sin vínculo: invitaciones/canje, RLS, cuotas propias, disponibilidad privada, límites, solapes concurrentes, cancelación y perfil.
- [ ] Validar manualmente el portal Sprint 09 desde celular y escritorio: registro/confirmación de email según Supabase, cambio admin↔jugador, selector de clubes, reserva visible en agenda administrativa y reglas online configurables.

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
