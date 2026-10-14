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
- [ ] (Hallazgo independiente, confirmado en Sprint 10B como SEC-02; ver bloque de seguridad más abajo) Con los privilegios por defecto de Supabase, las RPC de otros módulos (cuotas, cantina, portal, series, etc.) conservan EXECUTE para `anon` porque sus migraciones solo hacen `revoke ... from public`. Cada RPC valida `auth.uid()` internamente, pero conviene una migración transversal que revoque explícitamente a `anon`. Sprint 10A lo hizo solo para las 9 RPC de torneos.
- [ ] (Hallazgo independiente, decisión de producto) Un torneo pasa a `completed` cuando terminan todas las categorías existentes, aunque luego se quisiera crear otra (queda cerrado). Confirmar con Rafa si debe cerrarse manualmente.
- [ ] (Menor) `tournament_entries.draw_position` nunca se completa al generar el fixture; el orden del sorteo solo se deduce de los partidos.
- [ ] Aplicar manualmente `20261013070000_canteen.sql` solo después de confirmar el historial remoto de migraciones anteriores; no editar ni reaplicar migraciones históricas.
- [ ] Ejecutar `supabase/verification/sprint-08-canteen-checks.sql` con owner/admin, staff y dos clubes: catálogo, ventas inmediata/pendiente, precio histórico, pagos parciales, idempotencia, anulación, RLS y concurrencia.
- [ ] Confirmar el historial remoto real de migraciones 01–08 antes de aplicar `20261013080000_player_portal.sql`; no reaplicar ni editar migraciones históricas.
- [ ] Ejecutar `supabase/verification/sprint-09-player-portal-checks.sql` con owner/admin, jugadores de dos clubes y cuenta sin vínculo: invitaciones/canje, RLS, cuotas propias, disponibilidad privada, límites, solapes concurrentes, cancelación y perfil.
- [ ] Validar manualmente el portal Sprint 09 desde celular y escritorio: registro/confirmación de email según Supabase, cambio admin↔jugador, selector de clubes, reserva visible en agenda administrativa y reglas online configurables.

## Seguridad — Sprint 10B (detalle, evidencia y verificación en `docs/SECURITY_AUDIT.md`)
Auditoría sin correcciones: 0 críticos, 1 alto, 4 medios, 8 bajos. **Sprint 10B.1 corrigió SEC-01…SEC-04 en el repositorio (migraciones `20261014020000`…`050000` + `CanteenPanel.tsx`); falta aplicarlas y verificarlas en Supabase** (ver ítem «Aplicar 10B.1»). Siguiente: SEC-05 (Sprint 10B.2), luego SEC-06…SEC-13. Migraciones nuevas; no editar las aplicadas:
- [ ] **Aplicar 10B.1 en Supabase:** (1) identificar con `supabase/verification/sec-02-anon-rpc-diagnostic.sql` la función SECURITY DEFINER ejecutable por anon (remoto = 1; local = 13) y confirmar si no es del repo; (2) correr `sprint-10b1-remote-readonly-checks.sql` antes y después; (3) desplegar frontend y aplicar `20261014020000`→`050000` (`supabase db push` o SQL Editor, uno por uno); (4) pruebas manuales de la lista al final de ese guion en un proyecto descartable (canje real, anon key, edición de cancha/cantina). No marcar SEC-01…04 como cerrados hasta registrar ese resultado.
- [~] **SEC-01 (ALTO) — corregido en repo, sin aplicar:** `redeem_player_invitation` usa `digest()` sin esquema (`20261013080000_player_portal.sql:151`); en Supabase falla con 42883 y **nadie puede canjear invitaciones**. El fix `20261014000000` solo cubrió `create_player_invitation`. Nueva migración con `extensions.digest`; no activar el portal hasta probar un canje real.
- [~] **SEC-02 (MEDIO) — corregido en repo, sin aplicar:** `revoke execute … from anon` en 14 RPC (series, cuotas, clases, cantina) + permisos antes de leer filas en `void_membership_due_payment`, `update/cancel_tennis_lesson`, `void_canteen_sale` + `alter default privileges … revoke execute … from anon`. Reemplaza el ítem «Hallazgo independiente» de arriba.
- [~] **SEC-03 (MEDIO) — corregido en repo, sin aplicar:** `authenticated` conserva INSERT/UPDATE/DELETE/TRUNCATE de tabla en `clubs`, `club_staff`, `courts`, `canteen_categories`, `canteen_products`; `courts` permite cambiar `club_id`/`created_at`. Revocar y re-otorgar por columna.
- [~] **SEC-04 (MEDIO) — corregido en repo, sin aplicar:** `player_membership_dues` suma pagos anulados como pagados (saldo mostrado al jugador menor al real).
- [ ] **SEC-05 (MEDIO) — Sprint 10B.2:** `CanteenPanel.tsx:113` genera un `client_request_id` nuevo en cada clic (la idempotencia no protege reintentos); el servidor devuelve la venta vieja si la clave se repite con otro carrito; pagos de cuota/cantina sin clave idempotente.
- [ ] **SEC-06…SEC-13 (BAJO):** torneos en borrador visibles al jugador (06); reservas online sin alineación de minutos (07, decisión de Rafa); `cancel_player_reservation` con `person_id` nulo (08); invitaciones sin tope de vencimiento (09, decisión de Rafa); fechas de pago/cantidades/longitudes sin límites (10); torneo cancelado acepta resultados y `delete_tournament_entry` siempre falla por FK (11); cabeceras CSP/Vercel, política de contraseña/registro público en Supabase Auth, `error.message` crudo en staff, `supabase/.temp` versionado, advisories de dev-deps (12); migración 08 editada tras su commit y guiones 04–09 solo manuales (13).
- [ ] Ejecutar `supabase/verification/security-audit-readonly-remote.sql` (solo SELECT) en Supabase y registrar: historial real de migraciones, esquema de pgcrypto, `anon_exec`, GRANT efectivos, anomalías de datos. Confirmar ajustes de Supabase Auth (registro público, confirmación de email, rate limits) y que el repo de GitHub es privado.
- [ ] Convertir los guiones manuales `sprint-04…09-*-checks.sql` en pruebas automáticas contra PostgreSQL local (modelo: `run-security-audit-local.sh`) y correrlas en cada cambio de migraciones.

- [ ] (Residual SEC-02, bajo) `cancel_player_reservation` y las RPC de torneos leen la fila antes de validar permisos (oráculo de existencia de UUID solo para autenticados). Corregir con el patrón de 10B.1 (leer solo `club_id`, validar, luego bloquear) cuando se toquen esas funciones.

## Diseño — próximos pasos
- [ ] Recibir el escudo original y las referencias visuales del club como archivos utilizables; reemplazar el marcador actual únicamente tras confirmar el activo correcto.
- [ ] Sprint 10C.2: profundizar el rediseño de Cuotas, Jugadores, Escuela, Torneos, Cantina y configuraciones, sin alterar los flujos funcionales.
- [ ] Probar manualmente la navegación de Sprint 10C.1 en escritorio y en pantallas de 360–430 px: menú Más, cambio Admin/Jugador, calendario, alta de reserva, formularios y ausencia de overflow horizontal.

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
