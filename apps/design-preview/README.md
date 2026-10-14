# Rafa Tenis — prototipo de diseño (DESIGN-01 + DESIGN-02)

Prototipo navegable e independiente para evaluar y aprobar la nueva dirección visual **antes** de integrarla en `apps/web`.

- Solo datos **ficticios** (`src/data/mock.ts`). No usa Supabase, variables de entorno, backend ni reglas reales.
- Hora simulada fija: **18:20** del día actual, para que la demo sea estable.
- No comparte código con `apps/web`; solo lee el escudo original desde `apps/web/public/branding/logoRafa.png` (alias `@brand`).
- No participa del build ni del deploy de producción: los scripts raíz (`pnpm build`, etc.) siguen filtrando `@rafa-tenis/web`.

## Ejecutar

Desde la raíz del repositorio:

```bash
pnpm install
pnpm --filter @rafa-tenis/design-preview dev
```

Abrir `http://localhost:5180` (si el puerto está ocupado, Vite usa el siguiente libre). Para probar desde un celular en la misma red: agregar `--host` al comando anterior.

Verificaciones disponibles: `pnpm --filter @rafa-tenis/design-preview typecheck | lint | test | build`.

### Rutas

| Ruta | Pantalla |
| --- | --- |
| `#/admin/inicio` | Inicio administrativo |
| `#/admin/reservas` | Calendario de reservas |
| `#/admin/cantina` | Cantina (vender / a cuenta / hoy) |
| `#/admin/jugadores` | Jugadores y socios: listado A–Z, buscador, filtros, ficha, alta/edición, membresía, baja lógica |
| `#/admin/cuotas` | Cuotas: períodos, cobranza, saldos, historial, pago total o parcial, anulación, emisión y configuración mensual |
| `#/admin/escuela` | Escuela: programación semanal, clases, profesores, alumnos, detalle y alta/edición |
| `#/admin/torneos` | Torneos: listado, detalle, categorías, inscripciones, sorteo, cuadro, partidos, resultados y campeones |
| `#/admin/canchas` | Canchas: estado en vivo, superficie, edición, activación y orden |
| `#/admin/portal` | Portal de jugadores: invitaciones, estados y cuentas vinculadas |
| `#/admin/configuracion` | Configuración del club y reglas de reservas online |
| `#/jugador/inicio`, `reservar`, `turnos`, `torneos`, `perfil` | Portal de jugadores |
| `#/acceso` | Acceso simulado: ingresar, registrarse, confirmar email, canjear invitación, elegir experiencia |
| `#/sistema` | Design system vivo (paleta, tipografía, componentes, estados, íconos) |

### Controles de revisión

La pestaña **Prototipo** (borde derecho; en celular es una pestaña mínima por encima de la barra inferior y se oculta mientras hay un diálogo abierto) permite:
cambiar de experiencia (Admin / Jugador / Acceso / Sistema), forzar el estado de los datos (**Normal / Carga / Vacío / Error**),
**simular fallo al guardar** (reservas, ventas, pagos, inscripciones, resultados, invitaciones e ingreso fallan para ver el reintento) y reiniciar los datos.
Este panel no forma parte del diseño de producto.

Cuentas de demostración de Acceso (contraseña `demo1234`): `admin@club.test` (administración), `martina@correo.test` (jugadora),
`rafa@club.test` (ambos accesos) y `nueva@correo.test` (cuenta sin club: debe canjear). Nada se envía ni se guarda.

## Design system

Tokens en `src/styles/tokens.css` en dos capas: paleta cruda y tokens semánticos (los componentes solo usan los semánticos).

| Rol | Token | Uso |
| --- | --- | --- |
| Verde club | `--green-900/800/700` | Chrome (sidebar, barras), héroes, acción `primary` |
| Amarillo pelota | `--ball-500` | **Una** acción principal por vista (`accent`), estado activo de navegación, «ahora» |
| Polvo de ladrillo | `--clay-500/600/700` | Canchas (marca `CourtMark`), torneos, saldos adeudados, línea de hora actual |
| Cal / tinta | `--chalk-*`, `--ink-*` | Fondo cálido de trabajo, tarjetas blancas, texto |
| Estados | `--red-*`, `--amber-*`, `--blue-*` | Error, advertencia, información |

- **Tipografía:** Barlow Condensed (display: títulos, horas, importes) + Barlow (texto). Cifras tabulares en horas y montos. Base 16 px; inputs a 16 px para evitar zoom en iOS. Se cargan desde Google Fonts con fallback de sistema.
- **Espaciado:** escala de 4 px (`--s-1`…`--s-16`), gutter 16/24/32 px según ancho.
- **Forma:** radios 6–28 px; botones 10–14 px; chips en píldora. Sombras con tinte verde.
- **Táctil:** objetivo mínimo 44 px; foco visible con anillo verde (amarillo sobre superficies oscuras); `prefers-reduced-motion` respetado.
- **Ocupaciones (agenda única):** reserva = verde, clase = amarillo, torneo = terracota, bloqueo = rayado gris. El color siempre va acompañado de texto.
- **Textura de cancha:** líneas de cancha en SVG sobre verde (`.texture-court`) para héroes y encabezados.

## Componentes reutilizables

**Base (`src/components/ui`)** — candidatos directos a `apps/web`:
`Button` (accent, primary, secondary, ghost, danger, on-dark · sm/md/lg · loading) · `IconButton` · `Badge` (8 tonos) · `Chip` ·
`SegmentedTabs` (tablist con flechas) · `Field` + `TextInput` / `SelectInput` / `TextArea` / `Switch` / `MoneyInput` / `NumberStepper` ·
`Modal` (diálogo centrado, panel lateral en escritorio y hoja inferior en celular; foco atrapado, Escape, bloqueo durante envío y pila de diálogos: solo el superior responde) ·
`ConfirmDialog` (confirmación con envío, error y reintento) · `PageHead` · `StatStrip` (indicadores que filtran) · `Meter` · `Stepper` · `Avatar` ·
`Crest` · `CourtMark` · `SectionHeader` · `EmptyState` · `ErrorState` · `Skeleton` · `Icon` (≈70 íconos propios, sin dependencias).

**De dominio (`src/components/domain.tsx`, `src/components/bracket.tsx`):** `MemberBadge`, `MethodPicker`, `CourtPicker` (libre/ocupada según el horario),
`PersonPicker` (buscador de fichas con alta rápida y motivos de deshabilitado), `PersonChip`, `SaveBar` (cambios sin guardar), `MatchCard` y `Bracket`
(cuadro con conectores en escritorio; pestañas y carrusel por ronda en celular).

**Lógica pura con pruebas (`src/lib`):** `tournament.ts` (tamaño de cuadro, reparto de pases libres, avance, campeón, marcador por lado), `dues.ts`
(estado y saldo de cuota desde pagos válidos, resumen de período, importes «35.000»), `agenda.ts` y `time.ts`.
Hooks en `data.ts`: `useCourts`, `usePeople`, `useAction` (latencia, error y reintento simulados) y `useIntent` (abrir una ficha, clase, partido o formulario al navegar).

Shells en `src/components/shell`: `AdminShell`, `PlayerShell`, `ProtoPanel`. Pantallas en `src/screens`. Estilos de módulos en `src/styles/modules.css`.

## Decisiones UX (DESIGN-01)

- **Inicio = «qué pasa ahora»**: héroe con canchas en juego, acción principal de reserva, tarjetas «Canchas ahora», próximos turnos, caja de cantina y pendientes del club.
- **Reservas**: el calendario es protagonista. Escritorio: grilla multicancha 07:00–23:00 cada 30 min con hora actual. Celular: tira de días, selector de cancha y vista **Panorama**. Una cancha inactiva solo aparece el día que todavía tiene ocupaciones cargadas.
- **Formulario de reserva** en panel lateral / hoja con prechequeo de solape y sugerencia de canchas libres. Reservar no genera cobro.
- **Cantina**: venta rápida, ticket lateral en escritorio y barra de carrito en celular; cobrar o anotar a cuenta; errores conservan el carrito.
- **Portal de jugadores**: experiencia propia y liviana; reserva en 4 pasos con las reglas online vigentes.
- **Una acción amarilla por vista**; el resto se resuelve con secundarios, chips o el botón «+» central del celular.

## DESIGN-02 — header y módulos

### Header (cambio solicitado)
- **Sin títulos de sección** en el header global (el `h1` queda oculto para lectores de pantalla). El lugar lo indican la navegación y el encabezado de cada pantalla (`PageHead`).
- **Celular (administración y portal)**: escudo original centrado de 60 × 68 px que **sobresale 16 px** bajo la barra, apoyado en un **zócalo verde** (saliente total de 20 px). A la izquierda, fecha y hora del club; a la derecha, configuración (solo administración) y cuenta. Cada lado tiene un ancho máximo que deja libre la franja del escudo (verificado entre 320 y 430 px); en ≤ 359 px el escudo baja a 54 px.
- **Espacio reservado y scroll**: el contenido arranca 20 px por debajo del zócalo. Al desplazarse el escudo se reduce al 68 % y queda dentro de la barra, de modo que nunca tapa contenido ni botones. Safe areas respetadas (`env(safe-area-inset-top)`); diálogos y toasts quedan por encima del header.
- **Escritorio/tablet**: el escudo sigue en la barra lateral o rail; la barra superior muestra fecha, hora del club y acciones. En el portal (sin barra lateral) el escudo cuelga 14 px junto a la marca y también se condensa.

### Interacciones simuladas (datos coherentes entre módulos)
Todo vive en un único store (`src/lib/store.ts`): un pago cargado en Cuotas se ve en el perfil de la jugadora; una clase o un partido programado aparece en la agenda;
una cancha desactivada sale de la agenda y del portal; las reglas online cambian lo que el portal deja reservar; una invitación generada se puede canjear en Acceso.
- **Jugadores**: crear (aviso de nombre duplicado, «guardar y cargar otro»), editar, membresía (no socio / socio / inactivo), baja lógica y reactivación, accesos a reservar, cobrar cuota e invitar al portal.
- **Cuotas**: emitir un período (idempotente), cuota individual, pago total o parcial (bloquea sobrepago), anular pago con motivo obligatorio, configurar importe y vencimiento sin cambiar cuotas emitidas.
- **Escuela**: clase única o semanal (≤ 12) con chequeo de cancha, de profesor y de horario pasado; sumar/quitar alumnos con cupo; cancelar una fecha; activar/desactivar profesores.
- **Torneos**: crear torneo (borrador o inscripción abierta), categorías singles/dobles, inscribir personas o parejas (o crear ficha rápida), sortear el cuadro con pases libres, programar partidos en la agenda (con conflictos), cargar o corregir resultado con validación del marcador o W.O., avance y campeón.
- **Canchas**: editar nombre y superficie, activar/desactivar con aviso de ocupaciones próximas, ordenar.
- **Configuración**: datos del club, reglas de reservas online con vista previa «así lo ve el jugador» y barra de guardado.
- **Invitaciones**: generar código de un uso con vencimiento, copiar código o mensaje, revocar, regenerar.
- **Acceso**: errores de credenciales y de conexión, registro con confirmación, canje y elección de experiencia.

### Decisiones UX (DESIGN-02)
- Fichas en **lista alfabética** con letra de índice; en escritorio pasa a tabla (membresía, saldo, próximo turno). Los indicadores superiores funcionan como filtros rápidos.
- Cuotas organizadas por **período** con resumen de cobranza; el saldo siempre se calcula desde pagos válidos (nunca un saldo editable). «Vencida» usa terracota, el tono de las deudas en todo el sistema.
- Escuela con **tablero semanal** en escritorio y tira de días en celular, con el amarillo de «clase» de la agenda; clases agrupadas por serie.
- Torneos: el cuadro abre en la **ronda en curso**; en celular se navega por pestañas de ronda o deslizando (se ve el borde de la ronda siguiente).
- Configuración en frases y controles simples (horarios, chips, contadores) en lugar de minutos o listas separadas por comas.

## Correspondencia con producción (`apps/web`)

| Prototipo | Producción | Notas para integrar |
| --- | --- | --- |
| Jugadores (`Players.tsx`) | `features/people/PeoplePanel.tsx` · `club_people`, `club_memberships` | Producción tiene ficha `active` + membresía active/inactive; «socio desde» = `joined_on`. Staff no gestiona membresías. |
| Cuotas (`Dues.tsx`) | `features/fees/FinancePanel.tsx`, `recordDuePayment.ts` · `club_fee_settings`, `membership_dues`, `membership_due_payments` | Emisión, pagos y anulación vía RPC idempotentes (10B.2). Solo owner/admin. |
| Escuela (`School.tsx`) | `features/school/SchoolPanel.tsx` · `club_coaches`, `tennis_lessons`, `tennis_lesson_students` | Las clases son ocupaciones `lesson`; el prototipo guarda los alumnos en la ocupación por simplicidad. |
| Torneos (`Tournaments.tsx`, `bracket.tsx`) | `features/tournaments/TournamentPanel.tsx`, `tournamentUtils.ts` | Generación y avance en PostgreSQL (D013/D017). En producción el estado del torneo es explícito. |
| Canchas (`Courts.tsx`) | `features/courts/CourtList.tsx` · `courts` | Nombre, superficie, activa y `display_order` existen. |
| Configuración (`Settings.tsx`) | `features/player/PlayerAccessPanel.tsx` (reglas online) + `FinancePanel` (cuota) | **Localidad, teléfono y edición del nombre del club no existen en producción** (propuesta a decidir). |
| Invitaciones (`Invitations.tsx`) | `PlayerAccessPanel.tsx` · RPC `create/revoke/list_player_invitations` | En producción el código no se recupera (se guarda su hash); el prototipo lo conserva solo para la demo de canje. |
| Acceso (`Access.tsx`) | `auth/LoginScreen.tsx`, `auth/AccessRouter.tsx`, `features/player/RedeemInvitationScreen.tsx` | Supabase Auth real; no existe recuperación de contraseña. |

## Riesgos de la futura integración
- El prototipo usa un store local con estados simplificados; producción necesita carga/errores por consulta, permisos por rol (owner/admin/staff) y respuestas de RPC.
- Las reglas que el prototipo aplica en la UI (horario pasado, solape de profesor, sobrepago, marcador coherente) deben seguir garantizadas en PostgreSQL.
- Reglas de reservas, cuota y vencimiento son **valores ficticios**: no tomarlos como políticas del club (D005).
- Fuentes desde Google Fonts y escudo de 859 kB: decidir autoalojamiento y optimizar la imagen antes de la PWA.
- `PLAYER_ID` fijo: tras canjear una invitación el portal sigue mostrando a Martina (simplificación de la demo).

## Adaptaciones responsive

| Ancho | Navegación | Contenido |
| --- | --- | --- |
| < 768 px (prioridad 360–430) | Header con escudo centrado + barra inferior con «+» central (Crear) y «Más» en hoja | 1 columna; indicadores y pasos deslizables; cuadro por rondas; modales como hoja inferior |
| 768–1023 px | Rail lateral con íconos y rótulos cortos | 2 columnas en tarjetas; tablero semanal y cuadro con scroll contenido |
| ≥ 1024 px | Sidebar agrupada (Operación / Club / Configuración) + barra superior con fecha y acciones | Tablas, tablero semanal de 7 días, cuadro completo con conectores, paneles laterales |
| ≥ 1440 px | Igual, con gutter más amplio | Las 6 canchas y las 7 columnas de la semana sin scroll |

## Estado

**Terminadas:** shell administrativo y portal con header nuevo, Inicio, Reservas, Cantina, Jugadores, Cuotas, Escuela, Torneos, Canchas, Configuración, Portal/Invitaciones, Acceso, portal de jugadores, design system vivo y estados de carga / vacío / error / confirmación en todos los módulos. Ya no quedan pantallas «pendiente de diseño».

**Pendientes de diseño:** catálogo de cantina, anulación de ventas y pago parcial por consumo en cantina, modo oscuro, PWA y notificaciones.

**Verificado en navegador (Chromium del panel de Claude):** 17 rutas sin desborde horizontal a 360, 390, 430, 768, 1024 y 1440 px (medido por script); header sin superposición entre 320 y 430 px; flujos de alta de jugador, pago parcial reflejado en el portal, resultado de torneo con validación y avance, alta de clase con conflicto de cancha, reglas online con guardado y canje de invitación, además de los de DESIGN-01. No se probó en dispositivos físicos, Safari/iOS ni con lector de pantalla.
