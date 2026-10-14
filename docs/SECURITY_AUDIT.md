# SECURITY_AUDIT.md — Sprint 10B (auditoría integral de seguridad)

Fecha: 2026-10-14 · Base: commit `1e99a8a` (Sprint 10A), árbol limpio al iniciar · Auditoría **sin correcciones**: no se modificó código de producción ni migraciones.

> **Actualización Sprint 10B.1:** SEC-01…SEC-04 están corregidos **en el repositorio** (4 migraciones nuevas, ver §9); **no aplicados ni verificados en Supabase real**. SEC-05…SEC-13 seguían abiertos en ese momento.

> **Actualización Sprint 10B.2:** SEC-05 está corregido **en el repositorio** (migración `20261014060000_idempotent_financial_operations.sql` + frontend de Cuotas y Cantina, ver §10); **no aplicado ni verificado en Supabase real**. SEC-06…SEC-13 siguen abiertos.

## 1. Alcance y método

**Auditado (código real del repositorio, no la documentación):** las 11 migraciones `supabase/migrations/` (Sprint 01 → 10A) y `supabase/bootstrap`; todas las funciones `SECURITY DEFINER`, GRANT/REVOKE, políticas RLS y triggers de guarda; `apps/web` (cliente Supabase, sesión, enrutado por rol, manejo de errores, PWA/service worker, variables de entorno); scripts `supabase/verification/*`; historial git de migraciones; `pnpm audit`.

**Clasificación de la evidencia** (exigida por el pedido):

| Etiqueta | Significado |
|---|---|
| **A — inspección** | Leído en el código/SQL; no ejecutado. |
| **B — prueba** | Ejecutado en un **PostgreSQL 17 local descartable** con roles `anon`/`authenticated`, `auth.uid()` simulado vía `request.jwt.claim.sub` y los *privilegios por defecto de Supabase emulados* (`supabase/verification/local-supabase-stub.sql`). Es PostgreSQL real, **no** Supabase: no pasa por PostgREST, JWT reales, ni la configuración del proyecto desplegado. |
| **C — requiere Supabase real** | No puede afirmarse desde el repo (estado de migraciones aplicadas, GRANT efectivos del proyecto, ajustes de Auth, Vercel). Se listan en §6. |

Un test con mocks de Vitest **no** se cuenta como evidencia de RLS (los 66 tests de frontend no ejercen RLS).

**Reproducible:** `supabase/verification/run-security-audit-local.sh` (clúster local descartable; no Docker, no remoto) ejecuta `security-audit-dynamic.sql` (matriz de roles × dos clubes, 163 comprobaciones) y las pruebas de concurrencia de dos sesiones. Para Supabase real: `supabase/verification/security-audit-readonly-remote.sql` (solo `SELECT` de catálogo).

## 2. Resumen ejecutivo

**No se encontró ningún hallazgo CRÍTICO**: ninguna vía confirmada para leer datos de otro club, elevar privilegios (jugador→admin, staff→owner, autoasignación a un club), registrar/anular pagos sin autorización ni alterar importes históricos. El aislamiento entre clubes y por rol se sostiene en PostgreSQL (RLS + FKs compuestas + RPC con `auth.uid()`), no solo en React.

Pero hay **un defecto ALTO que bloquea el portal de jugadores**: `redeem_player_invitation` sigue usando `digest()` sin esquema, así que **nadie puede canjear una invitación** en Supabase (la corrección de Sprint 10A arregló solo `create_player_invitation`).

| Severidad | Cantidad | IDs |
|---|---|---|
| CRÍTICO | 0 | — |
| ALTO | 1 | SEC-01 |
| MEDIO | 4 | SEC-02, SEC-03, SEC-04, SEC-05 |
| BAJO | 8 | SEC-06 … SEC-13 |

Resultado de las pruebas locales (B): **144 comprobaciones cumplen la expectativa segura y 19 no**; 18 corresponden a SEC-01…SEC-10 y 1 es una decisión de producto documentada (el staff puede crear bloqueos, D008), no un defecto. Concurrencia (2 sesiones): pagos de cuota, pagos de cantina, solape de reservas, límite de reservas online por persona y atomicidad de series **pasan** (13/13, 5 de ellas con el parche hipotético de SEC-01). `pnpm typecheck`, `lint`, `test` (66), `build`: OK (ver §7).

### Decisiones de producto que el código ya implementa (confirmar con Rafa)
Staff puede crear/editar **bloqueos**, programar partidos y cargar resultados, y cobrar cantina (D008/D013/D014); solo owner/admin ven cuotas, membresías, catálogo, invitaciones y estructura de torneos. Cualquier jugador vinculado ve los nombres de los inscriptos de todos los torneos del club (SEC-06).

### Lo que se verificó como correcto (resumen)
- **Escalada de privilegios:** `club_staff` no tiene políticas INSERT/UPDATE/DELETE; jugador, staff y admin no pueden crear/ascender membresías, ni escribir `club_person_auth_links` (B).
- **Aislamiento entre clubes:** owner B no ve reservas/personas/cuotas de A ni puede emitir, pagar, anular, programar o crear torneos/categorías/invitaciones en A; las FKs compuestas `(club_id, x_id)` rechazan cancha/persona/producto/profesor de otro club incluso para staff directo (B).
- **Finanzas:** cuotas, pagos y ventas solo se escriben por RPC (sin INSERT/UPDATE/DELETE directo para owner); sobrepagos rechazados, también **bajo concurrencia** (lock por cuota/venta); anulación auditada y única; precio histórico preservado al subir el precio; staff no ve cuotas ni configuración financiera ni anula ventas (B).
- **Agenda:** la exclusión GiST rechaza solapes reserva/bloqueo/clase/partido/reserva online, permite turnos contiguos, cancelar libera, la serie semanal es atómica y las filas `lesson`/`tournament_match` no se pueden insertar directo (B).
- **Portal:** un jugador solo lee sus cuotas/perfil/reservas por RPC; no puede cancelar reservas ajenas, ni usar RPC administrativas, ni consultar otro club; sin vínculo no accede a nada; el error de solape no filtra identidad de terceros; el portal no devuelve notas ni teléfonos ajenos (B).
- **Invitaciones:** 32 bytes aleatorios, solo se guarda SHA-256, un uso, mensaje de error genérico (inexistente/vencido/usado/revocado), canje concurrente → un solo ganador (probado con la función corregida hipotéticamente, ver SEC-01) (B).
- **SECURITY DEFINER:** todas las funciones `SECURITY DEFINER` de `public`/`private` fijan `search_path` en `pg_catalog[, public]` (B); `private` no es accesible para `anon`.
- **Frontend:** solo `VITE_SUPABASE_URL` y clave `sb_publishable_…`; ningún `service_role`/secreto en `src`, `dist` ni en git (A); el service worker precachea solo 7 estáticos, sin rutas runtime que cacheen respuestas de Supabase (A, inspección de `dist/sw.js`); el portal usa mensajes de error genéricos (A).

## 3. Hallazgos

### SEC-01 — ALTO — El canje de invitaciones no funciona en Supabase (corrección criptográfica incompleta)
1. **ID/Severidad:** SEC-01 · ALTO (integridad/disponibilidad del módulo de mayor prioridad; no es una fuga de datos).
2. **Ubicación:** `supabase/migrations/20261013080000_player_portal.sql:151` (`digest(trim(p_code), 'sha256')`, `search_path = pg_catalog, public`). La corrección `20261014000000_fix_player_invitation_crypto.sql:70-88` solo reemplaza `create_player_invitation` por `extensions.gen_random_bytes/digest`.
3. **Problema:** en Supabase pgcrypto vive en el esquema `extensions` (el propio fix de 10A lo asume). `redeem_player_invitation` no fue corregida: `digest` no se resuelve con ese `search_path`.
4. **Evidencia (B):** con el stub que replica `extensions`, `redeem_player_invitation(<código válido>)` → `ERR 42883 function digest(text, unknown) does not exist`. Con un parche hipotético *solo en la base descartable* (`extensions.digest`) el canje funciona y pasan: un solo uso, concurrencia (un ganador, un vínculo), revocado, vencido, mensaje genérico. Ninguna prueba remota de Sprint 09 llegó a ejecutarse (los guiones son listas manuales).
5. **Consecuencia:** ningún jugador puede vincular su cuenta ⇒ el portal es inutilizable aunque la migración 08 esté aplicada. Además el cliente recibe el texto interno del error de PostgreSQL (menor).
6. **Corrección:** nueva migración con `create or replace function public.redeem_player_invitation` idéntica salvo `extensions.digest(...)`; nunca editar 08/09.
7. **Migración SQL:** **sí** (nueva, p. ej. `…_fix_redeem_player_invitation_crypto.sql`).
8. **Verificar:** ejecutar `run-security-audit-local.sh` quitando el parche C6 (debe pasar con la migración real) y, en Supabase de prueba, canjear una invitación real con un usuario sin vínculo + `select to_regprocedure('extensions.digest(text,text)')`.

### SEC-02 — MEDIO — 14 RPC administrativas (13 `SECURITY DEFINER` + 1 envoltorio) siguen ejecutables por `anon`
1. SEC-02 · MEDIO (defensa en profundidad; sin explotación directa encontrada).
2. **Ubicación:** `revoke … from public` sin `from anon` en `20261013020000:139`, `20261013030000:166-169`, `20261013040000:258-262`, `20261013050000:300`, `20261013070000:213`. Solo torneos (10A, `20261014010000:148`) y portal (`20261013080000:358`) revocan a `anon`.
3. **Problema:** con los privilegios por defecto de Supabase, `revoke … from public` no quita el EXECUTE explícito de `anon`. Afecta `create_weekly_reservation_series` (×2), `set_club_fee_settings`, `generate_membership_dues`, `create_individual_membership_due`, `record_membership_due_payment`, `void_membership_due_payment`, `create_tennis_lesson`, `update_tennis_lesson`, `cancel_tennis_lesson`, `create_weekly_tennis_lesson_series`, `create_canteen_sale`, `record_canteen_sale_payment`, `void_canteen_sale`.
4. **Evidencia (B):** 13 funciones `SECURITY DEFINER` con `has_function_privilege('anon', …, 'EXECUTE') = true`. Todas validan `auth.uid()` y respondían `42501` a `anon` (creación, pagos, series, cantina). Pero `void_membership_due_payment` (`:240-242`), `update_tennis_lesson` (`:212-214`), `cancel_tennis_lesson` (`:236-238`) y `void_canteen_sale` (`:186-188`) **leen/bloquean la fila antes de comprobar permisos**: `anon` obtuvo `El pago no existe.` (oráculo de existencia de UUID; los UUID no son adivinables).
5. **Consecuencia:** hoy, ruido y un oráculo menor; mañana, cualquier RPC nueva sin chequeo de `auth.uid()` quedaría expuesta al público sin sesión.
6. **Corrección:** `revoke execute on function … from anon` para las 14, mover la comprobación de permisos antes de cualquier lectura en las 4 funciones indicadas, y `alter default privileges in schema public revoke execute on functions from anon` para el rol que ejecuta las migraciones.
7. **Migración:** sí (transversal).
8. **Verificar:** consulta §2 de `security-audit-readonly-remote.sql` → `anon_exec = false` en todas las de aplicación; `security-audit-dynamic.sql` área `3 anon` sin hallazgos. **C:** confirmar en el proyecto real.

### SEC-03 — MEDIO — `authenticated` conserva privilegios de tabla completos en 5 tablas
1. SEC-03 · MEDIO (hoy lo contiene RLS; contradice lo documentado).
2. **Ubicación:** `20261013000000_club_access_and_courts.sql:115-120` (solo `revoke … from anon`; `grant select` y `update (cols)` son aditivos) para `clubs`, `club_staff`, `courts`; `20261013070000_canteen.sql:208-209` (`grant select, insert, update` de tabla completa) para `canteen_categories` y `canteen_products`. Las migraciones 02–10 sí hacen `revoke all … from authenticated`.
3. **Problema:** `authenticated` mantiene INSERT/UPDATE/DELETE/TRUNCATE (por defecto de Supabase) en `club_staff`, `clubs`, `courts`; y UPDATE de **todas** las columnas en `courts` y los dos catálogos. La barrera real es RLS (sin política de escritura en `club_staff`/`clubs`), no el privilegio. `TRUNCATE` ignora RLS (no es alcanzable por PostgREST, sí por una conexión SQL directa).
4. **Evidencia (B):** `has_table_privilege('authenticated','public.club_staff','INSERT'/'UPDATE'/'DELETE') = true`; un admin de A y B ejecutó `update courts set club_id = <B>` y `set created_at = …` con éxito (`OK rows=1`) ; un producto **con ventas** no pudo moverse de club, pero solo por la FK de `canteen_sale_items` (un producto sin ventas no se probó). Contradice `ARCHITECTURE.md` («solo owner y admin pueden actualizar los campos configurables de una cancha»: nombre, superficie, estado, orden).
5. **Consecuencia:** un admin de dos clubes puede reasignar canchas/productos sin ventas entre clubes y reescribir `created_at`; una política RLS futura mal escrita en `club_staff` permitiría autoascenso porque el GRANT ya está dado.
6. **Corrección:** `revoke all on table clubs, club_staff, courts, canteen_categories, canteen_products from authenticated` y re-otorgar solo `select` + `update (name, surface, active, display_order)` (courts) + `insert/update` por columna en catálogo.
7. **Migración:** sí. 8. **Verificar:** área `2 grants` del guion dinámico sin hallazgos; consulta §3 del guion remoto. **C:** los GRANT reales del proyecto pueden diferir de los emulados.

### SEC-04 — MEDIO — El portal muestra saldos incorrectos: cuenta pagos anulados como pagados
1. SEC-04 · MEDIO (integridad de información financiera mostrada al cliente; el panel administrativo es correcto).
2. **Ubicación:** `20261013080000_player_portal.sql:273` (`coalesce(sum(p.amount_cents), 0) as paid_cents` sin `filter (where p.voided_at is null)`; el filtro solo se aplicó a `jsonb_agg`).
3. **Evidencia (B):** cuota 500 000, pago válido 200 000 + pago anulado 100 000 → el portal devuelve `paid_cents = 300000` (y `balance_cents = 200000` en vez de 300 000) mientras `payments` lista solo el pago válido (inconsistente consigo mismo). `feeUtils.ts:18` (admin) sí excluye anulados.
4. **Consecuencia:** un jugador ve menos deuda de la real tras un pago rechazado/anulado → conflictos de cobro.
5. **Corrección:** `sum(p.amount_cents) filter (where p.voided_at is null)`. **Migración:** sí (`create or replace function`). **Verificar:** caso del guion dinámico (área 7) y test de integración con pago anulado.

### SEC-05 — MEDIO — La protección contra cobros duplicados no funciona de extremo a extremo
1. SEC-05 · MEDIO (integridad financiera; requiere reintento tras fallo de red o doble envío).
2. **Ubicación:** `apps/web/src/features/canteen/CanteenPanel.tsx:113` (`p_client_request_id: crypto.randomUUID()` dentro de `confirmSale`: **una clave nueva en cada clic**); `20261013070000_canteen.sql:105-132` (compara solo la clave, no el contenido); pagos sin clave idempotente: `20261013040000:196-230` (`record_membership_due_payment`) y `20261013070000:164-179`.
3. **Problema:** si la venta se confirma en el servidor pero la respuesta se pierde, reintentar crea **otra** venta (y otro cobro en efectivo) porque el cliente regenera la clave. Con una clave repetida y carrito distinto el servidor devuelve la venta anterior en silencio. Los pagos de cuota/cantina permiten dos registros idénticos mientras haya saldo.
4. **Evidencia (B):** misma `client_request_id` con `quantity 9` devolvió `OK` (la venta de `quantity 2`); la concurrencia de pagos sí se serializa (C1/C2 pasan). **A** para el cliente.
5. **Consecuencia:** ventas/cobros duplicados difíciles de detectar y sin anulación de pagos en cantina.
6. **Corrección:** el cliente genera la clave una vez por carrito y la renueva solo tras éxito o cambio del carrito; el servidor guarda un hash del payload y rechaza (22023/23505) la reutilización con otro contenido; agregar clave idempotente opcional a los pagos. **Migración:** sí (columnas/funciones) + cambio de frontend.
7. **Verificar:** test: dos llamadas con la misma clave y mismo payload → una fila; mismo clave/otro payload → error; test de UI que reutiliza la clave tras un error de red simulado.
8. **Estado (Sprint 10B.2):** corregido en el repositorio; no aplicado en Supabase. Ver §10.

### SEC-06 — BAJO — `player_tournaments` expone borradores/cancelados y nombres de todos los participantes
`20261013080000_player_portal.sql:277-351` filtra solo por club (`where t.club_id = p_club_id`), sin estado ni acotamiento. (B) Un jugador A1 ve `Torneo borrador A`. Muestra `display_name` de cualquier inscripción a todo jugador vinculado (puede incluir menores) y el JSON crece sin límite. **Corrección:** limitar a `registration_open/in_progress/completed` recientes y decidir con Rafa si los nombres son públicos para jugadores. Migración: sí (create or replace).

### SEC-07 — BAJO — Reservas online aceptan cualquier minuto de inicio
`20261013080000_player_portal.sql:210` valida ventana horaria, duración y límite pero no alineación. (B) `10:07-11:07` fue aceptado y bloquea de hecho el turno de las 10:00. Un jugador vinculado puede fragmentar la agenda con hasta `max_active_reservations` turnos (y repetir cancelar/reservar sin límite de frecuencia). Requiere decisión de producto (D005: no imponer reglas sin Rafa), p. ej. un `slot_minutes` configurable. Migración: sí.

### SEC-08 — BAJO — `cancel_player_reservation` falla abierto con `person_id` nulo
`20261013080000_player_portal.sql:241`: `v_reservation.person_id <> v_person_id` es NULL (no TRUE) si la reserva no tiene ficha; la cadena `OR` puede quedar en NULL y el `IF` no lanza. (B) Un usuario dual (staff + jugador vinculado) canceló desde la RPC del portal una reserva de mostrador sin ficha creada por él (`OK rows=1`). No es una escalada (ya podía cancelarla como staff) ni alcanza a un jugador puro (no puede crear reservas sin ficha), pero rompe la regla «solo cancela las suyas». **Corrección:** `is distinct from` y comprobar `person_id is not null`. Migración: sí.

### SEC-09 — BAJO — Invitaciones sin tope de vencimiento ni vínculo con identidad
`20261013080000_player_portal.sql:107`: solo exige `expires_at > now()`. (B) Se aceptó una invitación a 100 años. El código es un secreto «al portador» (256 bits, buen hash y un solo uso) no ligado a un email/cuenta: si se filtra por WhatsApp, quien lo canje primero obtiene las cuotas, teléfono y reservas de esa persona. Sin límite de intentos propio (depende de Supabase). **Corrección:** tope (p. ej. ≤ 14 días, decisión de Rafa), opcional vínculo por email, y monitoreo/rate limit de Auth. Migración: sí.

### SEC-10 — BAJO — Datos sin límites razonables (fechas de pago, cantidades, longitudes)
(B) `record_membership_due_payment` aceptó `payment_date = 2099-01-01`; `create_canteen_sale` aceptó `quantity = 2147483647` (total ≈ 2,1·10¹⁴ centavos). Ningún campo de texto tiene `max length` (`full_name`, `notes`, `customer_name`; `update_player_profile` deja que un jugador escriba texto arbitrario en su ficha, visible para el personal: `20261013080000:263`). Corrección: CHECK acotados (`NOT VALID` primero) y límites en RPC. Migración: sí.

### SEC-11 — BAJO — Torneo cancelado acepta resultados y pasa a `completed`; no se puede quitar una inscripción
`record_tournament_match_result` (`20261014010000:82-108`) no mira el estado del torneo. (B) Tras cancelar un torneo `in_progress`, un resultado lo convirtió en `completed`. Además `delete_tournament_entry` (`20261013060000:200-210`) **siempre falla**: `tournament_entry_members` referencia la inscripción con `on delete restrict` (B: `23503`). Corrección: validar estado en `record/schedule` y borrar miembros dentro de la RPC. Migración: sí.

### SEC-12 — BAJO — Endurecimiento de frontend/infraestructura
- Sin cabeceras de seguridad (CSP, `frame-ancestors`, `nosniff`, `Referrer-Policy`): no hay `vercel.json` ni meta CSP (`apps/web/index.html`, `vite.config.ts`). La sesión vive en `localStorage` (supabase-js), por lo que una XSS sería grave; hoy no se encontró `dangerouslySetInnerHTML`, `eval` ni HTML dinámico (A).
- Registro público abierto en `LoginScreen.tsx:25` y contraseña mínima 6 (`:45`): la protección real (confirmación de email, rate limits, captcha, política de contraseña) depende de ajustes de Supabase Auth **no verificables desde el repo (C)**. Las cuentas sin vínculo no acceden a nada (B).
- `TournamentPanel.tsx:10` y `CanteenPanel.tsx:19-20` muestran `error.message` crudo de PostgreSQL al personal (nombres de constraints/tablas); el portal usa mensajes genéricos.
- `supabase/.temp/*` (project-ref, URL del pooler, versiones) está versionado; `supabase/bootstrap/rafa-tenis.sql` fija el UUID del owner. No son secretos, pero conviene ignorarlos y revisar si el repo GitHub es privado.
- `pnpm audit`: **0 vulnerabilidades en producción**; 4 en dependencias de desarrollo (`vitest`/`@vitest/mocker` moderadas, `tinypool` críticas), solo afectan al entorno de test.

### SEC-13 — BAJO — Proceso: migraciones editadas y verificaciones manuales
- `20261013080000_player_portal.sql` se editó después de su primer commit (`a95b975` → `1e99a8a`: corrección de un paréntesis de más en `player_tournaments`). Si esa versión ya se aplicó, remoto y repo pueden divergir; `CURRENT_STATE.md` afirma que 09 «no está aplicada» y que hay «cambios sin commit» (ya committeados), mientras que existe una migración de corrección originada por un error ejecutado en Supabase. El estado remoto real **no se puede deducir**.
- Los guiones `sprint-04…09-*-checks.sql` son listas de pasos manuales (comentados), sin aserciones ni ejecución en CI; ninguno detectó SEC-01 ni SEC-04. Solo `sprint-10a-*` (torneos) son automáticos.

## 4. Matriz de verificación

| Área | A (inspección) | B (prueba local PostgreSQL) | C (Supabase real) |
|---|---|---|---|
| Elevación de privilegios (`club_staff`, links) | ✔ | ✔ 8 pruebas | historial/GRANT reales |
| RLS por club y por rol (todas las tablas) | ✔ | ✔ roles × 2 clubes | políticas desplegadas = repo |
| Funciones `SECURITY DEFINER` (auth, club, search_path) | ✔ | ✔ | EXECUTE efectivo de `anon` |
| Portal jugador (10 puntos del pedido) | ✔ | ✔ (canje con parche hipotético) | flujo real con PostgREST/JWT |
| Invitaciones (hash, un uso, vencimiento, revocación, concurrencia) | ✔ | ✔ | pgcrypto en `extensions` |
| Finanzas (sobrepago, concurrencia, anulación, precio histórico) | ✔ | ✔ + concurrencia 2 sesiones | datos reales sin anomalías |
| Reservas/GiST/series/límites online | ✔ | ✔ + concurrencia | ✔ pendiente |
| Frontend/PWA/secretos | ✔ | — (tests con mocks, no cuentan) | cabeceras Vercel, Auth settings |
| Migraciones aplicadas / drift | ✔ | — | `supabase_migrations.schema_migrations` |

## 5. Plan de verificación (roles y escenarios)

Actores: Owner A, Admin A, Staff A, Jugador A1, Jugador A2, Jugador B1, usuario autenticado sin vínculo, anónimo; dos clubes (A y B). Usuario dual (staff + jugador) para el cambio de experiencia.

1. **Local (seguro, ya disponible):** `PGPORT=… bash supabase/verification/run-security-audit-local.sh` contra un PostgreSQL local descartable (instrucciones en el encabezado: nunca apuntar a Supabase ni a datos reales). Se espera que hoy reporte los 19 resultados mapeados (18 hallazgos + 1 decisión de producto) y que las 13 pruebas de concurrencia pasen.
2. **Remoto de solo lectura:** pegar `security-audit-readonly-remote.sql` en el SQL Editor de un **proyecto de prueba** (o de producción, solo SELECT) y comparar con §3 (SEC-01/02/03/13).
3. **Remoto dinámico:** en un proyecto Supabase **separado y descartable** (no producción), aplicar las migraciones y las correcciones del Sprint 10C, crear los 8 actores con Auth real y ejecutar con `supabase-js` los mismos escenarios (esto añade PostgREST/JWT, que el stub no cubre) incluyendo el canje real de invitaciones y un `signUp` con confirmación de email.
4. No ejecutar pruebas destructivas ni de concurrencia sobre la base de producción.

**Pruebas que aún faltan (además de las del guion):** RLS de `tournament_*`/`tennis_*` para lectura directa por staff vs jugador; `update_tennis_lesson`/`create_weekly_tennis_lesson_series` con profesor/alumnos de otro club; DST en series; rate limiting de Auth; XSS/CSP reales en el despliegue.

## 6. Verificaciones pendientes contra Supabase real
Historial de migraciones aplicado y si 08/09/10A existen; esquema de pgcrypto (SEC-01); `has_function_privilege('anon', …)` y GRANT de tabla efectivos (SEC-02/03); políticas desplegadas = repo; ajustes de Auth (registro, confirmación de email, contraseña, rate limits, captcha); cabeceras de Vercel; anomalías en datos ya existentes (consultas §6–8 del guion remoto); repo GitHub privado.

## 7. Validación del repositorio
`pnpm typecheck` ✔ · `pnpm lint` ✔ · `pnpm test` ✔ 12 archivos / 66 tests · `pnpm build` ✔ (advertencia de chunk > 500 kB preexistente; PWA 7 entradas, 613 KiB). No se modificó código de producción para lograrlo. Nota: esas pruebas usan mocks y no validan RLS.

## 8. Propuesta de correcciones (Sprint 10C, no iniciado)
Orden sugerido, una migración nueva por tema (no editar migraciones aplicadas):
1. **SEC-01** `redeem_player_invitation` con `extensions.digest` (desbloquea el portal) + prueba de canje real.
2. **SEC-02 + SEC-03** migración transversal de privilegios (`revoke … from anon`; revocar/re-otorgar por columna en las 5 tablas; `alter default privileges`; permisos antes de lecturas en las 4 RPC).
3. **SEC-04** filtro de anulados en `player_membership_dues`; **SEC-08** `is distinct from`; **SEC-06** filtro de estado en `player_tournaments`.
4. **SEC-05** clave idempotente estable en frontend + hash de payload + clave para pagos.
5. **SEC-10/11/09/07** límites de datos, estado de torneo, tope de invitaciones y alineación (estas dos últimas requieren decisión de Rafa).
6. **SEC-12/13** cabeceras en Vercel, política de contraseña/rate limits en Auth, ignorar `supabase/.temp`, convertir los guiones 04–09 en pruebas automáticas contra PostgreSQL local, y reconciliar el historial real de migraciones antes de aplicar nada nuevo.

## 9. Sprint 10B.1 — corrección de SEC-01…SEC-04 (repositorio; **pendiente de aplicar y verificar en Supabase**)

| ID | Estado en repo | Migración nueva (aplicar en este orden; independientes entre sí, todas requieren 01–10A) |
|---|---|---|
| SEC-01 | Corregido | `20261014020000_fix_redeem_player_invitation_crypto.sql` — `redeem_player_invitation` con `extensions.digest`; aborta si `extensions.digest(text,text)` no existe. Mismo cuerpo: identidad, vencimiento, revocación, uso único, `FOR UPDATE` (concurrencia), aislamiento por club. |
| SEC-02 | Corregido | `20261014030000_revoke_anon_rpc_and_check_permissions_first.sql` — `revoke … from public, anon` + `grant … to authenticated` en las 14 RPC; `alter default privileges in schema public revoke execute on functions from anon`; permisos antes de leer en `void_membership_due_payment`, `update_tennis_lesson`, `cancel_tennis_lesson`, `void_canteen_sale` y `revoke_player_invitation` (id inexistente y sin permiso dan el mismo 42501; ya no se bloquean filas de otros clubes). |
| SEC-03 | Corregido | `20261014040000_restrict_table_privileges.sql` — `clubs`, `club_staff`, `courts`, `canteen_categories`, `canteen_products`: `revoke all` + `select`; `courts` solo `update (name, surface, active, display_order)`; catálogo `insert/update` por columna **sin `club_id` en UPDATE**; trigger `private.prevent_club_id_change` (club_id inmutable incluso para superusuario). **Requiere el cambio de `CanteenPanel.tsx`** (los UPDATE ya no envían `club_id`): desplegar el frontend antes o junto con la migración. |
| SEC-04 | Corregido | `20261014050000_fix_player_membership_dues_balance.sql` — `paid_cents` y `balance_cents` excluyen pagos anulados (`filter (where voided_at is null)`); no toca datos. |

**Archivos de frontend:** `apps/web/src/features/canteen/CanteenPanel.tsx` (payload de UPDATE sin `club_id`; el INSERT lo conserva).

### 9.1 Diferencia entre el entorno local y Supabase real (SEC-02)
Supabase real informó `rpc_accesibles_anon = 1`; el PostgreSQL local, con privilegios por defecto de Supabase **emulados** (`local-supabase-stub.sql`), da 13 funciones `SECURITY DEFINER` (+1 envoltorio no `SECURITY DEFINER`). La diferencia indica que los privilegios por defecto del proyecto real no coinciden con lo emulado (hipótesis: el proyecto actual no concede EXECUTE a `anon` en funciones nuevas) o que parte de las 13 no existe/difiere en remoto. **Desde el repo no se puede saber qué función es la remota ni la causa**: puede ser una función de la plataforma o creada a mano. `supabase/verification/sec-02-anon-rpc-diagnostic.sql` (solo lectura) la identifica (propietario, ACL, directa o vía PUBLIC, de extensión o no, del repo o no) y muestra `pg_default_acl`. La migración revoca de `anon` solo las 14 funciones del repo con firma explícita y es inocua si ya no lo tenían; **no revoca a ciegas funciones desconocidas**: si el diagnóstico muestra una que no es del repo, revisarla a mano. Que `migraciones_aplicadas = 11` coincida con el repo no prueba cuáles son: el chequeo M0 de `sprint-10b1-remote-readonly-checks.sql` compara por versión.

### 9.2 Pruebas realizadas (PostgreSQL 17.10 local descartable en clúster temporal, sin Docker; **no es Supabase**)
`supabase/verification/run-sprint-10b1-local.sh` (seed con RPC reales → control negativo en una copia del estado previo → migraciones sobre esos datos → verificaciones → concurrencia):
- Control negativo (estado previo): **55 de 150** verificaciones incumplidas (SEC-01 15, SEC-02 10, SEC-03 22, SEC-04 8), es decir, las pruebas detectan los hallazgos.
- Con las 4 migraciones: **150/150** (SEC-01 35, SEC-02 46, SEC-03 48, SEC-04 21): generación y canje de invitación con vinculación Auth↔persona, segundo canje (misma y otra cuenta), vencida, revocada, persona inactiva, cruce de clubes, anon; anon sin EXECUTE en las 14 RPC y en toda función propia de `public`; authenticated conserva las RPC administrativas y del portal; id inexistente = id ajeno (mismo 42501); `courts.club_id`/`created_at`/INSERT/DELETE rechazados, edición legítima de canchas, `club_id` inmutable para superusuario (trigger); cantina por rol (owner/admin catálogo, staff vende y lee); saldos con pago válido, anulado, parcial, saldado y solo-anulado, paridad con el cálculo administrativo, privacidad de cuotas, huella de importes sin cambios.
- Concurrencia (2 sesiones): canje simultáneo → 1 ganador y 1 vínculo; anulación simultánea de pago de cuota y de venta de cantina → 1 sola.
- `run-security-audit-local.sh` (matriz de la auditoría 10B, ya sin el parche hipotético): de 19 resultados fuera de lo seguro quedan 7, todos ajenos a este sprint (D008 y SEC-05/06/07/08/10); las 13 comprobaciones de concurrencia pasan.
- `pnpm typecheck`, `lint`, `test` (66) y `build`: OK.

### 9.3 Pendiente / riesgos restantes
- Aplicar las 4 migraciones en Supabase **y** verificar con `sprint-10b1-remote-readonly-checks.sql` (SELECT, apto producción: antes ⇒ falsos donde hay hallazgo, después ⇒ todo `t`) más la lista manual del final de ese archivo (canje real con PostgREST/JWT, anon key, edición de cancha/cantina desde la app) en un proyecto **descartable**. Sin eso el remoto no está validado.
- Oráculo de existencia de UUID solo para usuarios **autenticados** (no anon) en `cancel_player_reservation` y las RPC de torneos (`update_tournament`, `create_tournament_category`, `create_tournament_entry`, `delete_tournament_entry`, `generate_tournament_fixture`, `schedule/cancel_tournament_match`, `record_tournament_match_result`): se leen antes de validar. Riesgo bajo (UUID no adivinables, exige sesión); no se tocó para no reescribir RPC grandes fuera de alcance.
- El privilegio PUBLIC por defecto sobre funciones nuevas sigue vigente: cada migración debe seguir haciendo `revoke … from public` explícito (la migración solo quita el default de `anon` en `public`). `anon` mantiene EXECUTE sobre las funciones de extensiones (`btree_gist` en `public`; no son `SECURITY DEFINER`).
- Sin cambios: privilegios por defecto de tablas; SEC-05 (Sprint 10B.2), SEC-06…SEC-13.


## 10. Sprint 10B.2 — corrección de SEC-05 (idempotencia de ventas y pagos; repositorio; **pendiente de aplicar y verificar en Supabase**)

### 10.1 Causa exacta
1. **Frontend (cantina):** `confirmSale` generaba `crypto.randomUUID()` en **cada clic**. Si la venta se confirmaba en PostgreSQL pero la respuesta se perdía, reintentar enviaba otra clave y creaba **otra venta con otro cobro**.
2. **`create_canteen_sale`:** solo comparaba la clave. Con la misma clave y otro carrito devolvía **en silencio la venta anterior**; además `p_client_request_id` tenía como valor por defecto `gen_random_uuid()`, de modo que omitirla desactivaba la idempotencia sin avisar.
3. **`record_membership_due_payment` y `record_canteen_sale_payment`:** no tenían ninguna clave. Dos envíos idénticos creaban dos pagos mientras quedara saldo (el bloqueo de fila solo evitaba el sobrepago).
4. **Frontend (cuotas y pagos de cantina):** sin identidad de operación ni guarda contra el doble envío más allá del botón deshabilitado.

### 10.2 Solución implementada
**Migración nueva** `supabase/migrations/20261014060000_idempotent_financial_operations.sql` (no modifica migraciones aplicadas ni registros históricos):
- `canteen_sales.request_hash` (sha256 del contenido normalizado: club, cliente, medio de pago e ítems ordenados por producto; **sin precios ni fechas**). Los pagos reciben `client_request_id uuid`. Restricciones `UNIQUE (club_id, client_request_id)` en ventas y en ambos tipos de pago (`NULL` no choca: los registros anteriores quedan intactos).
- `create_canteen_sale` (misma firma): la clave es obligatoria (`null` ⇒ 22023); valida y normaliza los ítems en memoria (se eliminó la tabla temporal), calcula el hash, toma un `pg_advisory_xact_lock` por `(club, clave)` y busca la clave **dentro del club ya autorizado**. Si existe: mismo hash **y** mismo `created_by` ⇒ devuelve la venta original; cualquier otra cosa ⇒ **23505**. El reintento se resuelve **antes** de validar el catálogo (una venta se puede recuperar aunque un producto se haya desactivado).
- `record_membership_due_payment` y `record_canteen_sale_payment`: nuevo `p_client_request_id` (obligatorio). Mismo patrón (candado por clave → bloqueo de la cuota/venta → búsqueda de la clave → comparación de **todos** los campos: cuota/venta, importe, fecha, método, referencia, observaciones y usuario → devolver o 23505) y **el reintento se resuelve antes de validar el saldo**: reenviar el pago que saldó la cuota devuelve el original en lugar de fallar por sobrepago. Un pago nuevo (clave nueva) sigue sujeto al control de sobrepago con bloqueo de fila.
- Se eliminaron las firmas de 7 argumentos de ambos pagos (dejarlas habría mantenido un camino sin idempotencia). `SECURITY DEFINER`, `search_path = pg_catalog, public`, `auth.uid()`/pertenencia al club/permisos **antes** de tocar datos, `revoke … from public, anon` y `grant … to authenticated` explícitos sobre las firmas nuevas (no se debilita 10B.1).

**Frontend** (solo Cuotas y Cantina; diseño sin cambios):
- `apps/web/src/lib/idempotency.ts` (nuevo): clave **por intención** (`claimOperationKey`), atada a una huella corta del contenido; se conserva en reintentos, doble clic y **recarga de la página** (sessionStorage: solo `{clave, huella, hora}`, sin importes ni nombres; vence a las 24 h; si el almacenamiento falla queda en memoria) y se descarta únicamente tras una confirmación (`releaseOperationKey`). `runIdempotentOperation` clasifica el resultado: *ok* / *rechazado por el servidor* (nada registrado; la clave se conserva) / *conflicto 23505* (la clave se descarta) / *incierto* (red, corte, timeout de 20 s, respuesta ilegible) — ante un resultado incierto **consulta la fila por su clave** (RLS por club) antes de rendirse.
- `CanteenPanel.tsx`: guarda `useRef` contra el doble envío, clave estable por carrito, carrito conservado ante errores inciertos, mensajes dentro del diálogo, botón «Reintentar confirmación/pago», «Vaciar» como decisión explícita de una venta nueva. Mismo tratamiento para los pagos de consumos pendientes.
- `fees/recordDuePayment.ts` (nuevo, compartido por `MemberAccount` y `FinancePanel`) y `PaymentDialog`: misma identidad estable, guarda de doble envío y «Reintentar pago».

### 10.3 Garantías de idempotencia (y su alcance)
- **Misma clave + mismo contenido + mismo usuario + mismo club ⇒ un único resultado persistido**, también con envíos simultáneos (candado por clave + `UNIQUE`). La garantía definitiva está en PostgreSQL; la UI solo evita generar claves nuevas por accidente.
- **Misma clave + otro contenido, o de otro usuario ⇒ 23505**, sin registrar nada. La clave es única **por club**: otro club puede usar el mismo UUID de forma independiente y nunca recibe filas ajenas (el candado, la búsqueda y la restricción incluyen `club_id`; la autorización ocurre antes).
- **Clave nueva ⇒ operación nueva**, aunque coincidan productos, importes, cliente o cuota. No se deduplica por contenido.
- Un reintento de un pago/venta **anulado** devuelve el registro original (anulado) y **no crea otro**; un cobro nuevo requiere una clave nueva.
- Los pagos inmediatos de una venta no llevan clave propia: los protege la de la venta (misma transacción).

### 10.4 Casos que siguen fuera de alcance (registrados en `docs/TASKS.md`)
- **Ventas anteriores a 10B.2** (`request_hash` NULL): su contenido no se puede verificar, por lo que reutilizar su clave se rechaza (23505). Los pagos anteriores no tienen clave. No se reescribió ningún registro histórico.
- **Anulaciones** (`void_*`): un reintento tras una respuesta perdida recibe «ya fue anulada» (estado final correcto; no es idempotente en el sentido de devolver el resultado).
- **Recarga + carrito distinto**: la identidad persistida solo se reutiliza si el carrito/pago reconstruido es idéntico; si el usuario reconstruye otro, es otra operación (el riesgo es de decisión humana, no de la clave). El carrito en sí no se persiste (no hay sincronización offline).
- Sin garantías para operaciones no financieras (reservas, clases, torneos) ni para cobros automáticos/Mercado Pago (no existen).
- Un tiempo de espera de 20 s en el cliente puede cortar la espera de una operación que el servidor aún está procesando: el reintento con la misma clave espera el candado y devuelve el resultado; por eso se consulta la fila antes de declarar un fallo.

### 10.5 Migraciones creadas
`20261014060000_idempotent_financial_operations.sql` (única). Requiere `20261013040000` y `20261013070000`; independiente de las migraciones 10B.1 (que además otorgaban `EXECUTE` sobre las firmas que esta migración reemplaza: por eso debe aplicarse **después** de ellas).
**Contrato:** el frontend nuevo exige las firmas nuevas (pagos con `p_client_request_id`). Aplicar migración y frontend **juntos**; entre ambos pasos el frontend anterior no puede registrar pagos (error de función inexistente: no duplica nada).

### 10.6 Resultados reales de las pruebas
**PostgreSQL 17.10 local descartable en un clúster temporal (sin Docker; NO es Supabase):** `supabase/verification/run-sprint-10b2-local.sh` — estado previo (≤ 10B.1) → datos históricos con las RPC anteriores → control negativo → migración → verificaciones → concurrencia con dos sesiones.
- **Control negativo (estado previo):** SEC-05 reproducido — la misma clave con otra cantidad devolvió `OK` y el mismo pago enviado dos veces quedó registrado dos veces (2 de 2).
- **Con la migración: 113 de 113 verificaciones** (`sprint-10b2-checks.sql`): estructura/privilegios (6), venta normal (3), doble envío (2), respuesta perdida (2), reintento (2), contenido distinto — cantidad, producto extra, medio de pago, pendiente↔pagada, otra persona (6), venta nueva con los mismos productos (2), pago de cuota (1), pago duplicado — importe, método, fecha, referencia y otra cuota (9), dos pagos legítimos del mismo importe y reenvío del pago que saldó la cuota (3), pago de cantina (1), reintento de pago de cantina (6), sobrepagos (6), aislamiento entre clubes y RLS de la consulta de recuperación (13), permisos/anon/usuario sin club/otro usuario/clave obligatoria/validaciones previas (22), anulaciones (10), datos históricos con huella md5 idéntica y saldos (19).
- **Concurrencia (23 comprobaciones, 0 fallas):** doble envío simultáneo de la misma venta (1 venta, 1 cobro, ambas sesiones reciben el mismo id), misma clave con contenido distinto (1 gana, el otro 23505), dos ventas distintas con el mismo contenido (2 ventas), reintento simultáneo de pago de cuota y de cantina (1 pago), dos pagos con claves distintas que exceden el saldo (solo 1 entra), reintento simultáneo con la anulación (sin deadlock; 1 pago, anulado).
- Guiones anteriores con la base limitada a ≤ 10B.1 (su contrato no cambia): `run-sprint-10b1-local.sh` 150/150 y concurrencia OK; `run-sprint-10a-local.sh` OK; `run-security-audit-local.sh` mantiene los 7 resultados ya documentados (incluido #143 = SEC-05, esperado en ese estado). Se ajustaron ambos `run-*` para no aplicar migraciones posteriores a 10B.1.
- **Frontend (Vitest, mocks — no ejercen PostgreSQL):** `pnpm test` 111 pruebas / 16 archivos (66 previas + 45 nuevas: `idempotency` 20, `recordDuePayment` 8, `PaymentDialog` 2, `CanteenPanel` 15): venta normal, doble clic, respuesta perdida y reintento con la misma clave, recuperación de una venta/pago ya confirmados, clave nueva tras confirmar / tras cambiar el carrito / tras «Vaciar», rechazos y 23505, persistencia tras recarga y sin sessionStorage, vencimiento a 24 h y timeout. Verificado con mutaciones: sin la guarda `useRef` falla la prueba de doble clic; con clave nueva por intento fallan 12 pruebas.
- `pnpm typecheck`, `pnpm lint` y `pnpm build`: OK (el build conserva la advertencia de JavaScript > 500 kB). Nota: `pnpm typecheck` (`tsc --noEmit` sobre un `tsconfig` con `references`) no comprueba archivos; el chequeo real lo hacen `tsc -p tsconfig.app.json --noEmit` (limpio) y `tsc -b` dentro de `pnpm build`.

### 10.7 Pasos para aplicar y verificaciones pendientes en Supabase (**nada de esto se ejecutó**)
1. Aplicar antes 10B.1 si todavía no está (ver §9.3), y confirmar el historial real de migraciones.
2. Correr `supabase/verification/sprint-10b2-remote-readonly-checks.sql` (SELECT): antes, la parte de estructura da `f`; después, todo `t`.
3. En una ventana corta, **aplicar `20261014060000` y desplegar el frontend** (juntos).
4. Volver a correr el guion de solo lectura (todo `t`; revisar las filas `info_*`).
5. Pruebas manuales en un proyecto descartable con dos clubes: (a) venta pagada y pendiente; (b) doble clic; (c) con las herramientas del navegador cortar la red justo al confirmar (o responder desde el servidor y cortar la respuesta), reintentar y comprobar **una sola** venta/pago; (d) recargar durante un resultado incierto y repetir el mismo carrito/pago; (e) dos pagos legítimos del mismo importe; (f) sobrepago; (g) anulación y reintento; (h) usuario del club B sin acceso a datos del club A.
No marcar SEC-05 como cerrado hasta registrar ese resultado.
