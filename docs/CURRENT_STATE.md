# CURRENT_STATE.md — 2026-10-14 (Sprint 10C.2 UX/UI administrativo; sobre 10B.1/10A/09)

## Implementado en el repositorio
- Workspace pnpm con React, Vite, TypeScript estricto y PWA responsive en `apps/web`.
- Cliente de Supabase configurado exclusivamente con `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`. Cuando faltan, la app muestra una pantalla clara de configuración pendiente.
- Inicio/cierre/restauración de sesión por email y contraseña. No hay registro público de administradores.
- Panel administrativo protegido: sin sesión muestra login; una sesión sin membresía muestra “No tenés acceso administrativo a ningún club.”
- Consulta de clubes y canchas aislada por club. Usuarios con varios clubes eligen un contexto explícito.
- Administración responsive de nombre, superficie, estado y orden de canchas para roles `owner` y `admin`; `staff` solo consulta.
- Migración `supabase/migrations/20261013000000_club_access_and_courts.sql` con `clubs`, `club_staff`, `courts`, trigger de actualización, permisos y RLS.
- Bootstrap administrativo idempotente en `supabase/bootstrap/rafa-tenis.sql`, y guion manual de verificaciones RLS en `supabase/verification/rls-checks.sql`.
- Migración `supabase/migrations/20261013010000_reservations.sql`: reservas, FK cancha/club, índice, exclusión GiST de solapes, trigger de cancha activa, permisos restringidos y RLS por membresía.
- Sección administrativa **Reservas**: agenda diaria, navegación por fecha, selección de fecha, seis columnas en escritorio y selector de cancha en celular; alta, edición y cancelación lógica de reservas.
- Migración `supabase/migrations/20261013020000_blocks_and_recurring_reservations.sql`: tipo de ocupación y motivo de bloqueo en `reservations`, referencia a `reservation_series`, exclusión GiST única y función atómica para series semanales de 1–12 ocurrencias.
- Calendario ampliado con creación, edición y cancelación lógica de bloqueos; motivo visible; reserva única o semanal; indicación discreta de ocurrencias; prechequeo explicativo de conflictos. Una edición/cancelación afecta solo la ocurrencia elegida.
- Utilidades y pruebas para intervalos, conversión `America/Argentina/Buenos_Aires`, bloqueos, recurrencias semanales, conflictos y error de solape. Guion remoto: `supabase/verification/sprint-03-blocks-and-series-checks.sql`.
- Migración `supabase/migrations/20261013030000_club_people_and_memberships.sql`: `club_people`, `club_memberships`, RLS/GRANT por roles, FK compuesta de club y vínculo opcional de fichas a reservas/series.
- Sección administrativa **Jugadores**: alta rápida con nombre, edición, baja lógica, búsqueda por nombre/teléfono, filtros simples y ficha con reservas realmente vinculadas. Owner/admin gestiona membresías; staff las consulta.
- El formulario de reserva conserva nombre libre y permite seleccionar una ficha activa, completando el nombre y persistiendo solo un vínculo opcional con snapshot textual.
- Migración `supabase/migrations/20261013040000_membership_dues_and_payments.sql`: configuración ARS por club, cuotas mensuales inmutables por período, pagos manuales auditables y RLS financiero exclusivo owner/admin.
- Sección administrativa **Cuotas**: configuración de importe/vencimiento, emisión mensual idempotente, cuota individual para socio activo, totales reales, búsqueda/filtros, detalle y registro de pagos.
- Ficha de socio: estado de cuenta, saldo calculado, cuotas y pagos históricos; pagos anulables con motivo desde el detalle. Staff no ve datos financieros.
- Migración `supabase/migrations/20261013050000_tennis_school.sql`: perfiles `club_coaches`, clases, alumnos y series de clases; los RPC crean, editan y cancelan clases de manera atómica junto con la ocupación de cancha.
- Sección administrativa **Escuela de tenis**: alta/activación de profesores desde personas existentes, clases individuales/grupales sin alumnos obligatorios, cupo, alta rápida de alumno, edición/cancelación y recurrencia semanal de hasta 12 clases. El calendario distingue clases y permite abrir su detalle; la creación puede iniciarse desde el calendario.
- Migración `supabase/migrations/20261013060000_tournaments.sql`: torneo, categorías Singles/Dobles, inscripciones con snapshots de `club_people`, fixture de eliminación directa, pases libres, resultados/W.O., campeón y programación atómica mediante la ocupación central `reservations` de tipo `tournament_match`.
- Sección administrativa **Torneos**: alta y apertura de inscripciones, categorías, alta rápida de persona, inscripciones, fixture por rondas, programación/cancelación de cancha y resultados. El calendario diferencia partidos de torneo y abre su gestión; no permite tratarlos como reservas genéricas.
- Migración `supabase/migrations/20261013070000_canteen.sql`: categorías, productos, ventas, ítems históricos y pagos de cantina, con RLS por club, RPC atómicas/idempotentes y protección de sobrepago. No aplicada ni verificada contra Supabase remoto.
- Sección **Cantina**: venta rápida por carrito, cobro inmediato o consumo pendiente con persona, pagos parciales, historial, anulación auditada sin pagos y catálogo administrable por owner/admin. La ficha de persona muestra sus consumos separados de cuotas.
- Migración `supabase/migrations/20261013080000_player_portal.sql`: vínculo Auth↔`club_people` por club, invitaciones de un uso con token hasheado, configuración de reservas online y RPC de alcance limitado. No aplica SQL remoto.
- La PWA ahora resuelve acceso administrativo y/o portal de jugador: registro por email/contraseña, canje de invitación, selector de club y cambio explícito de experiencia cuando la cuenta tiene ambos permisos.
- Portal responsive: inicio, disponibilidad sin identidad de terceros, reserva/cancelación segura propia, perfil limitado, reservas, consulta de cuotas propias y torneos. Administración suma emisión/revocación manual de invitaciones y configuración de reglas online.
- Guion remoto agregado: `supabase/verification/sprint-09-player-portal-checks.sql`.

## Verificado localmente
- El usuario informó haber verificado manualmente: inicio de sesión, acceso owner, seis canchas, edición y persistencia tras recargar contra el proyecto Supabase.
- En Sprint 8 finalizaron correctamente `pnpm typecheck`, `pnpm lint`, `pnpm test` (32 pruebas) y `pnpm build`. El build emitió la advertencia de bundle JavaScript superior a 500 kB; no se alteró el alcance para resolverla.
- En Sprint 09 finalizaron correctamente `pnpm typecheck`, `pnpm lint`, `pnpm test` (33 pruebas) y `pnpm build`. El build conserva esa advertencia de bundle; no se amplió el alcance para resolverla.
- Sprint 10A (torneos): causa del error `tournament_matches_next_target` reproducida en PostgreSQL 17 local: con 2 inscripciones `generate_tournament_fixture` insertaba la final con `next_match_id` NULL y `next_slot` 1 (3, 4, 5, 6, 8 y 16 ya funcionaban). Además se reprodujeron dos defectos en `record_tournament_match_result` (ganador ajeno/partido sin rival aceptado; ronda 1 bloqueada tras jugar una ronda 2 entre pases libres). Corrección: `supabase/migrations/20261014010000_fix_tournament_fixture.sql`.
- Sprint 10A en PostgreSQL 17 local descartable (clúster temporal con stubs mínimos de Supabase, sin Docker; `supabase/verification/run-sprint-10a-local.sh`): 1778 verificaciones OK (cuadros de 2 a 32 inscripciones jugados hasta el campeón con W.O., dobles de 2/3/7/8/16/32, generación duplicada, ganadores inválidos, BYE jugado primero, torneo multi-categoría, constraints, permisos/RLS entre dos clubes, anon) y concurrencia con dos sesiones (una sola generación). La migración se aplicó sobre datos generados con las funciones anteriores: huella de fixtures idéntica y fixtures legados siguen siendo jugables. El control negativo (mismo guion sin la migración) falla con el error reportado. Esto **no** es Supabase real: no se probó PostgREST, sesiones JWT reales ni las políticas del proyecto desplegado.
- Sprint 10A: `pnpm typecheck`, `pnpm lint`, `pnpm test` (66 pruebas, 12 archivos) y `pnpm build` pasaron. El build conserva la advertencia de bundle >500 kB.
- Las verificaciones locales no equivalen a pruebas remotas de PostgreSQL/RLS.
- No se ejecutaron pruebas de RLS, exclusión GiST, atomicidad o concurrencia contra PostgreSQL/Supabase durante este sprint.
- Sprint 7 pendiente de ejecutar remotamente: migración, RLS, RPC, fixture, avances y superposiciones de partidos contra Supabase real.
- Sprint 8 pendiente de ejecutar remotamente: migración, RLS, RPC, precio histórico, idempotencia, pagos concurrentes, anulación y flujos desde escritorio/celular.
- Sprint 09 pendiente de ejecutar remotamente: migración, invitaciones, canje atómico, aislamiento financiero, límite concurrente, calendario administrativo y uso móvil.

## Migraciones e infraestructura remota
- Migraciones versionadas en repositorio: **sí**.
- Sprint 1 aplicado y funcionalidad básica: **verificado manualmente por el usuario, no revalidado por este sprint**.
- Sprint 2/Sprint 3/Sprint 4/Sprint 5: **el usuario informó que Sprint 5 funciona contra Supabase; por sus dependencias se infiere que fueron aplicadas**. No se revalidaron sus versiones, RLS exhaustivo ni concurrencia en este sprint.
- Sprint 6: **migración versionada localmente, no aplicada remotamente**.
- Sprint 7: **migración versionada localmente, no aplicada remotamente**.
- Sprint 8: **migración versionada localmente, no aplicada remotamente**.
- Sprint 09: **migración versionada localmente, no aplicada remotamente**. No se pudo inspeccionar el historial remoto desde el repositorio; confirmar primero el estado 01–08. Hay además `20261014000000_fix_player_invitation_crypto.sql` y cambios locales sin commit en `20261013080000_player_portal.sql` (ajenos a Sprint 10A, preservados).
- Sprint 10A: `20261014010000_fix_tournament_fixture.sql` **versionada localmente, no aplicada remotamente**. El bug de producción **no está resuelto hasta aplicarla y recorrer un torneo completo**. Solo toca objetos de torneos (migración 06); no depende de 07–10.
- Exclusión temporal entre reservas/bloqueos/clases, RLS, funciones de series, personas/socios y garantías financieras contra Supabase real: **pendientes de verificación reproducible**.

## Contradicción detectada
La arquitectura previa proyectaba una entidad `players`, pero las migraciones existentes no la creaban. Sprint 4 crea `club_people` como entidad real para evitar confundir una proyección documental con un esquema aplicado. No se hizo commit ni push.

El pedido de Sprint 08 informa que Sprint 07 fue desplegado y que al generar fixture aparece `tournament_matches_next_target`; la documentación previa aún lo indicaba como no aplicado remotamente. Se registra el fallo como bug pendiente. Sprint 10A identificó la causa reproducible (categoría de 2 inscripciones) y versionó la corrección, pero sigue pendiente aplicarla y verificarla en el entorno desplegado. No se sabe cuántas inscripciones tenía la categoría que falló: si eran 3 o más, esa falla concreta no queda explicada y debe re-investigarse con el mensaje exacto tras aplicar la migración. El roadmap histórico llama Sprint 7 al portal, pero el pedido actual lo define como Sprint 09.

## Auditoría de seguridad (Sprint 10B, sin correcciones; detalle en `docs/SECURITY_AUDIT.md`)
Sin críticos; 1 alto, 4 medios, 8 bajos. Contradicciones con lo documentado más arriba:
- El **canje de invitaciones del portal no funciona en Supabase**: `redeem_player_invitation` sigue usando `digest()` sin esquema; el fix `20261014000000_fix_player_invitation_crypto.sql` solo corrige `create_player_invitation`. El flujo «registro → canje» descrito en Sprint 09 está incompleto (SEC-01).
- `ARCHITECTURE.md` indica que solo owner/admin cambian nombre/superficie/estado/orden de canchas, pero `20261013000000` no revoca los privilegios por defecto de `authenticated` en `courts`, `clubs`, `club_staff` (SEC-03); las RPC de cuotas, escuela y cantina siguen ejecutables por `anon` aunque validan `auth.uid()` (SEC-02).
- «Cambios locales sin commit en `20261013080000_player_portal.sql`» quedó obsoleto: se incluyeron en el commit `1e99a8a` (corrección de un paréntesis en `player_tournaments`). Si esa migración ya se aplicó con el texto anterior, el repo y el remoto pueden diferir; el historial remoto real sigue sin confirmarse.
- Evidencia nueva (PostgreSQL 17 local descartable con privilegios por defecto de Supabase emulados, **no** Supabase real): 144 de 163 comprobaciones de la matriz de roles cumplen la expectativa segura (las 19 restantes están mapeadas a hallazgos) y las 13 pruebas de concurrencia pasan (`supabase/verification/run-security-audit-local.sh`). Sigue pendiente toda verificación contra Supabase real.
- `pnpm typecheck`, `lint`, `test` (66) y `build` pasaron en Sprint 10B; no se modificó código de producción.

## Correcciones de seguridad — Sprint 10B.1 (en repositorio; detalle en `docs/SECURITY_AUDIT.md` §9)
- SEC-01…SEC-04 corregidos con 4 migraciones nuevas, **versionadas localmente y NO aplicadas en Supabase**: `20261014020000_fix_redeem_player_invitation_crypto.sql`, `20261014030000_revoke_anon_rpc_and_check_permissions_first.sql`, `20261014040000_restrict_table_privileges.sql`, `20261014050000_fix_player_membership_dues_balance.sql` (independientes entre sí; requieren 01–10A). Un cambio de frontend: `CanteenPanel.tsx` ya no envía `club_id` en los UPDATE de catálogo (desplegar antes o junto con la migración de privilegios).
- Hasta aplicarlas: el canje de invitaciones sigue roto en remoto, `anon` conserva EXECUTE en RPC administrativas (si la plataforma lo concede), `courts.club_id` sigue editable y el portal sigue mostrando saldos incorrectos.
- Supabase real (informado por el usuario, solo lectura): pgcrypto en `extensions`; `rpc_accesibles_anon` = 1; 0 tablas sin RLS; 0 permisos de tabla para anon; 11 migraciones registradas; 0 cuotas sobrepagadas; 0 reservas con cancha de otro club. No coincide con el PostgreSQL local emulado (13 funciones para anon): causa no determinada desde el repo (`supabase/verification/sec-02-anon-rpc-diagnostic.sql`).
- Evidencia local (PostgreSQL 17.10 descartable, **no Supabase**; `supabase/verification/run-sprint-10b1-local.sh`): control negativo 55/150 incumplidas en el estado previo; con las migraciones 150/150 y concurrencia OK (canje, anulaciones). `run-security-audit-local.sh` quedó sin el parche hipotético de canje. `pnpm typecheck`, `lint`, `test` (66) y `build` OK.
- Abiertos: SEC-05 (Sprint 10B.2) y SEC-06…SEC-13; oráculo de existencia de UUID (solo autenticados) en `cancel_player_reservation` y RPC de torneos.

## Sprint 10C.1 — diseño y navegación (local)
- Se incorporó una capa de tokens CSS para la identidad visual: verde institucional, verde oscuro, amarillo de acento, terracota, superficies cálidas, espaciado, radios, sombras y estados de foco.
- Administración: navegación lateral agrupada en escritorio; en móvil, barra inferior con Inicio, Reservas, Cantina y Más. El inicio ofrece accesos a reservas, cantina y jugadores sin inventar métricas ni datos.
- Portal del jugador: navegación diferenciada; en móvil, Inicio, Reservar, Mis turnos y Más. Calendario, formularios, tarjetas y modales recibieron mejoras de contraste, jerarquía, tamaño táctil y safe areas.
- No se modificaron tablas, migraciones, consultas, RPC, permisos ni reglas de negocio. No hubo despliegue ni prueba manual visual en navegador/dispositivo.
- El repositorio contiene el ícono técnico y un escudo PNG en `apps/web/public/branding/logoRafa.png`. La afirmación previa de que no existía escudo era incorrecta; se requiere confirmación del club solo si se desea sustituir este activo por otro.
- Validación local: `pnpm typecheck`, `pnpm lint`, `pnpm test` (66 pruebas, 12 archivos) y `pnpm build` finalizaron correctamente. El build conserva la advertencia de JavaScript superior a 500 kB.

## Sprint 10C.2 — módulos administrativos (local)
- Jugadores, cuotas, escuela, torneos, cantina y canchas/configuración comparten superficies, jerarquías, indicadores textuales de estado, foco visible y controles táctiles del sistema de 10C.1, sin reemplazar componentes ni alterar sus flujos.
- En anchos de hasta 899 px, la administración conserva la navegación inferior y los módulos de dos columnas pasan a una sola columna; las listas usan filas/cards legibles. El fixture conserva sus rondas horizontales con desplazamiento contenido y ajuste por ronda.
- La cabecera utiliza el escudo existente del repositorio, sin crear ni modificar archivos de branding. No se modificaron tablas, migraciones, consultas, RPC, permisos, cálculos ni reglas de negocio.
- Validación local: `pnpm typecheck`, `pnpm lint`, `pnpm test` (66 pruebas, 12 archivos) y `pnpm build` finalizaron correctamente. El build mantiene la advertencia conocida de JavaScript superior a 500 kB.
- Pendiente: recorrido visual manual autenticado con datos reales, incluyendo 360/390/430/768/1024/1440 px, formularios/modales, navegación, foco por teclado y ausencia de overflow horizontal.

## No implementado
No hay edición masiva de series, recurrencias infinitas, pagos/liquidaciones/comisiones de profesores, mensualidades de alumnos, cobros automáticos/anticipados, Mercado Pago API, facturación fiscal, stock, caja formal, torneos por zonas/doble eliminación/ranking/siembra/inscripción pública, recuperación de cuentas, despliegue, pruebas RLS remotas ni funcionalidad offline transaccional.

## Próximo trabajo
Aplicar en Supabase (orden: frontend → migraciones 20261014020000…050000) y correr `supabase/verification/sprint-10b1-remote-readonly-checks.sql` y las pruebas manuales de su pie, en un proyecto descartable si es posible. Antes, identificar con `sec-02-anon-rpc-diagnostic.sql` la función SECURITY DEFINER que `anon` ejecuta hoy en remoto. Luego, lo siguiente de esta sección:
Confirmar en Supabase el historial de Sprint 2–8, aplicar `20261014010000_fix_tournament_fixture.sql` y recorrer un torneo completo (torneo, inscripciones abiertas, una categoría de 2 inscripciones y otra de 6, fixture, programación, W.O., resultados hasta campeón; repetir en dobles). Aplicar Sprint 09 solo después de comprobar el historial y ejecutar el guion nuevo con usuarios de dos clubes. Luego validar portal, agenda administrativa y reservas desde PC y celular.
