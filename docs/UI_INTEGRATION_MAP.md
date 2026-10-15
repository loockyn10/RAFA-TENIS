# UI_INTEGRATION_MAP.md — integración del diseño aprobado en `apps/web`

Referencia visual exacta: `apps/design-preview` (solo lectura, demo publicada; no se modificó). Este documento es el punto de partida para **Integración 02 y 03**. Estado: **Integración 01** (local, sin commit, rama `feat/rafa-ui-integration`).

## 1. Estrategia (leer primero)
- **Coexistencia de CSS sin reescribir módulos.** Los módulos aún no integrados conservan su CSS previo, ahora acotado: en `apps/web/src/styles.css` los 78 selectores de elemento desnudo (`button`, `input`, `label`, `h1–h4`, `main`, `footer`, `strong`…) pasan a `:where(.legacy-scope) <elemento>` (especificidad 0, igual que antes). Todo lo viejo vive dentro de `.legacy-scope`; todo lo nuevo, dentro de `.rt` o portaleado a `.rt`. Las clases con nombre idéntico se renombraron en la copia nueva: `eyebrow→kicker`, `admin-content→shell-content`, `product-grid→pos-grid`, `sale-list/row→pos-sale-list/row`, `quick-actions→home-quick`, `pending→pos-pending`, `account-actions→rt-account-actions`; variables `--border-strong→--line-strong`, `--focus-ring→--ring`.
- **Lienzo transitorio.** `AdminPanel` envuelve cada módulo viejo en `<Legacy>` = `.legacy-zone.legacy-scope` (panel verde oscuro con su paleta 11A, `src/design/legacy-bridge.css`). Al integrar un módulo se reemplaza su `<Legacy>` por `<div className="rt">`; cuando no queden módulos viejos se elimina `legacy-bridge.css`, `.legacy-scope` y `styles.css`.
- **Copia, no dependencia.** `apps/web/src/design/` es una copia del design system del prototipo (tokens, base, components, shell, screens, modules-common, `ui/*`). Sin imports cruzados: no se tocó `apps/design-preview`. `integration.css` reúne lo que el prototipo no necesitaba (alerta de éxito, catálogo, filas con acciones, tabs desplazables).
- **Backend intacto.** No se tocó Supabase, migraciones, RLS, RPC ni cálculos. Las reglas de negocio siguen en PostgreSQL; el prechequeo de solapes de la UI es informativo (la restricción GiST es definitiva y se sigue mostrando su error).

## 2. Pantallas integradas
| Pantalla | Archivos | Datos/servicios reales |
| --- | --- | --- |
| Shell (sidebar/rail/barra inferior, header con escudo, «+», Más, Cuenta) | `features/shell/AdminShell.tsx`, `roleLabel.ts`, `design/shell.css` | Rol y club de `AdminPanel` (`club_staff`, `clubs`); cierre de sesión (`useAuth.signOut`); reloj en la zona del club |
| Inicio | `features/home/AdminHome.tsx`, `useHomeData.ts` | `reservations` (solo hoy, mismos filtros que la agenda); `canteen_sale_payments` (cobrado hoy) y conteo de `canteen_sales` de hoy; `courts` de `AdminPanel` |
| Reservas | `features/reservations/ReservationCalendar.tsx`, `occupationView.ts` | Misma lógica de antes: insert/update/cancelación lógica, RPC `create_weekly_reservation_series`, prechequeo + error 23P01, bloqueos, tipos clase/torneo |
| Cantina | `features/canteen/CanteenPanel.tsx`, `design/domain.tsx` | Sin cambios de lógica: `create_canteen_sale`, `record_canteen_sale_payment`, `void_canteen_sale`, catálogo, idempotencia 10B.2 (`lib/idempotency.ts`) |
| Marcos de acceso/login/canje/portal | `auth/AppFrame.tsx`, `auth/AccessRouter.tsx` | Sin cambios funcionales; siguen con su CSS previo |

## 3. Componentes reutilizados del prototipo
`Button`, `IconButton`, `Badge`, `Chip`, `SegmentedTabs`, `Field` + `TextInput/SelectInput/TextArea/Switch/MoneyInput`, `Modal` (diálogo / panel lateral / hoja inferior), `ConfirmDialog`, `Stepper`, `StatStrip`, `Avatar`, `Crest`, `CourtMark`, `SectionHeader`, `EmptyState`, `ErrorState`, `Skeleton`, `Icon`; de dominio `CourtPicker` y `MethodPicker` (reescritos sin store). Hooks `useScrolled/useIsMobile` (robustos sin `matchMedia`).

## 4. Qué se conectó a la navegación
Inicio, Reservas, Cantina, Jugadores, Cuotas (solo owner/admin), Escuela, Torneos, Canchas y Portal de jugadores (solo owner/admin) tienen destino real. Botón «+»: Nueva reserva, Bloquear cancha (formularios reales de la agenda), Nueva clase (SchoolPanel `requestedCreation`), Nuevo jugador (`PeoplePanel.createRequest`), Venta rápida y Cuotas y pagos (navegan). Cuenta: correo, rol, selector de club (solo con varios), «Mi portal de jugador» (solo con acceso de jugador), cerrar sesión. Un rol sin permiso que quede en `fees`/`playerAccess` vuelve a Inicio.

## 5. Diferencias prototipo ↔ producción
- **Sin datos ficticios ni panel «Prototipo».** Nada de store simulado, hora fija 18:20, fallos simulados, selector de usuarios.
- **Header:** no hay icono de «Configuración del club» (esa pantalla no existe en producción; ver `TASKS.md` DESIGN-02). El rol y el correo son los reales.
- **Inicio:** «A cuenta» y «Cuotas del mes» no muestran importes (requerirían consultas no proporcionadas); se enlazan sin valor. Cantina hoy muestra *cobrado hoy* y *ventas de hoy*; si la lectura falla, «Dato no disponible». «Escuela hoy / Torneos» cuentan ocupaciones de hoy (la agenda no trae alumnos).
- **Reservas:** abrir una ocupación muestra primero el detalle (Editar / Cancelar / Gestionar en Escuela o Torneos). La tira de días no muestra carga por día (habría exigido leer toda la semana). «Nueva reserva» desde Inicio o «+» **navega a Reservas y abre el formulario** (la lógica de guardado vive en la agenda). Cancelar usa confirmación dentro de la app, no `window.confirm`. Duración y horarios no asumen reglas del club (franja visual 07:00–23:00 y paso de 30 min ya existían).
- **Cantina:** «Consumos pendientes» (no «A cuenta»), por venta con pago parcial; «Historial» lista las últimas 150 ventas (no solo hoy); pestaña «Productos» (catálogo, categorías, anulación) que el prototipo no diseñó; «Más vendidos» sale de las ventas cargadas y solo aparece con 3 o más productos. Importes con 2 decimales (`formatArs`). El selector de persona es el de fichas reales con alta rápida.
- **Fuentes:** Barlow/Barlow Condensed desde Google Fonts (`index.html`), igual que el prototipo; sin autoalojar. Colores `theme-color` y manifiesto PWA alineados con el verde del header (`#0b3a2b`).

## 6. Pendientes funcionales / de diseño
- Módulos con interfaz anterior (en `<Legacy>`): Jugadores, Cuotas, Escuela, Torneos, Canchas, Portal de jugadores/Invitaciones; Login, Canje de invitación y **Portal del jugador** (`PlayerPortal`, con su propio header, fuera del shell nuevo).
- Configuración del club / reglas online siguen en `PlayerAccessPanel` y `FinancePanel` (no hay pantalla «Configuración» propia).
- Autoalojar fuentes y optimizar el escudo (859 kB); modo oscuro, notificaciones.
- Avatar de cuenta usa iniciales del correo (no hay nombre de perfil en Auth).

## 7. Riesgos
1. **Verificación remota ausente:** todo se probó con un Supabase **falso** local (scripts descartables fuera del repo) y con mocks de Vitest; **no** contra Supabase real ni con RLS. El comportamiento por rol real (owner/admin/staff) solo está verificado en la UI (staff oculta Cuotas, Portal, Productos y resumen).
2. **Dos sistemas de CSS conviven:** cualquier selector de elemento desnudo nuevo en `styles.css` se rompería; los elementos nuevos deben ir bajo `.rt`. Los modales nuevos portalean a `document.body` con clase `rt`.
3. **`.legacy-zone` se ve distinto del resto** (panel verde oscuro): es transitorio y esperado.
4. **Lectura extra en Inicio:** 3 consultas (agenda del día, cobros del día, conteo de ventas) cada 2 min con la pestaña abierta; si el volumen crece, revisar.
5. Bundle JS principal 659 kB (advertencia previa, no resuelta).

## 8. Siguiente trabajo (Integración 02)
1. Jugadores y Cuotas: reemplazar `<Legacy>` por las pantallas de `design-preview/src/screens/admin/Players.tsx` y `Dues.tsx` sobre `PeoplePanel`/`FinancePanel` (conservar RPC idempotentes de pagos y permisos de staff).
2. Escuela, Torneos (cuadro `bracket.tsx` + `tournament.ts` sin reglas duplicadas: PostgreSQL decide), Canchas.
3. Después: Portal/Invitaciones, Acceso y portal del jugador; retirar `legacy-bridge.css` y el CSS previo.
4. Recorrido visual autenticado contra Supabase real a 360/390/430/768/1024/1440 px.
