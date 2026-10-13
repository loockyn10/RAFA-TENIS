# PRODUCT.md — contrato funcional preliminar

## Visión
Ayudar a Rafa a administrar su club y eventualmente permitir autogestión de jugadores, **sin perder la dinámica de club de amigos**. La herramienta no debe convertir cada conversación, préstamo o venta en un trámite obligatorio.

## Contexto proporcionado por el usuario / kit
- Seis canchas de polvo de ladrillo.
- Hay socios con cuota; uso diurno de cancha por socios sin cargo adicional; iluminación nocturna puede cobrarse.
- No socios abonan alquiler; **$10.000/h fue un ejemplo, no una tarifa aprobada**.
- Alquiler por cancha/tiempo, no por cantidad de jugadores; Rafa puede cobrar un importe diferente de las horas jugadas.
- Hay profesores con tarifas independientes, torneos A/B/C, actividades y cantina (bebidas, hamburguesas, pelotas, cubregrips, etc.).
- Personas pueden no tener teléfono/cuenta; menores pueden participar con ficha propia.

Estos puntos describen el contexto conversado y deben contrastarse con Rafa antes de automatizar reglas económicas o de operación.

## Personas / acceso
1. **Admin (Rafa)**: gestionar todas las operaciones que se habiliten.
2. **Staff**: operar según permisos explícitos.
3. **Profesor**: clases, alumnos y disponibilidad cuando se implemente.
4. **Socio/jugador**: autogestión móvil futura, voluntaria.
5. **No socio/visitante**: reservas o inscripción conforme política futura.
6. **Jugador sin cuenta digital**: ficha y reservas creadas por operador.

## Flujo inicial propuesto (a validar con Rafa)
- Agenda diaria por cancha; elegir fecha/cancha/franja; alta de reserva con nombre libre o ficha existente y nota opcional.
- Duración flexible; cambios/cancelación; bloqueos por mantenimiento, lluvia, riego o evento, según necesidad.
- Datos de contacto opcionales; no exigir login al jugador.
- Los turnos confirmados/bloqueos ocupan la cancha; las cancelaciones la liberan. La BD impide dos ocupaciones incompatibles al mismo tiempo; turnos contiguos compatibles.
- No reservar ni cobrar automáticamente al marcar una franja; no impedir a Rafa corregir uso, sin que ello desactive controles de solape.

**Propuestas no confirmadas:** quién puede reservar, prioridad de turnos fijos, horarios, duración mínima, anticipación y consecuencias de no-show. Ver `VALIDACION_RAFA.md`. Hasta decidir, interfaz simple configurable, sin reglas restrictivas ocultas.

## Módulos y orden
- **P0** Operación de canchas: configuración, reservas, edición, cancelación, bloqueos, antisolapamiento.
- **P1** Personas y socios; acceso opcional del jugador; cuotas, profesores/clases y torneos/fixtures/resultados.
- **P2** Eventos, cantina liviana y economía asociada.
- **Later** Rankings, estadísticas avanzadas, gamificación, publicación en tiendas.

## Reglas permanentes de producto
- **Una única fuente de ocupación** para canchas: juegos, clases, partidos y bloqueos; módulos futuros la utilizan, no crean agendas paralelas.
- **Sin cuenta obligatoria:** `players` no requiere usuario de Auth.
- **Separación económica:** reserva, uso real, cargo y pago son conceptos distintos. El precio no varía automáticamente por cantidad de jugadores.
- **Sin suspensión por mora** ni cálculo automático del cobro basado solo en tiempo antes de validarlo con Rafa.
- **Privacidad:** contactos, pagos y notas privados; torneos publicados exponen solo datos autorizados.

## Fuera del MVP de calendario
Pagos automáticos/Mercado Pago, facturación, POS, stock, torneos completos, ranking, publicación en stores, WhatsApp automatizado, check-in geolocalizado.

## Criterio de éxito inicial
Rafa identifica en segundos las seis canchas, reserva para alguien que contactó fuera de la app, edita/cancela fácilmente y no puede confirmar dos ocupaciones simultáneas de una misma cancha desde distintos operadores.

## Estado del producto técnico
El Sprint 1 incorpora acceso administrativo por email/contraseña y la consulta/administración de canchas según rol. El usuario informó haber verificado manualmente el acceso owner, las seis canchas, su edición y persistencia.

El Sprint 3 amplía localmente esa agenda única con bloqueos activos/cancelados (motivo y observaciones) y reservas semanales de hasta 12 ocurrencias. Un bloqueo activo y una reserva confirmada se excluyen mutuamente; una ocurrencia se puede editar o cancelar sin modificar el resto de su serie. La vista usa transitoriamente 07:00–23:00 e intervalos visuales de 30 minutos; no constituyen una regla permanente de la base de datos. No se habilitan registro público, jugadores, cobros ni reglas comerciales.

El Sprint 4 incorpora localmente fichas de jugadores por club, sin cuenta obligatoria, y membresías de socio activas/inactivas separadas de `club_staff`. Una reserva puede seguir usando nombre libre o vincular opcionalmente una ficha; conserva siempre el nombre textual histórico. No se agregan cuotas, cobros ni reglas por mora.

El Sprint 5 incorpora localmente cuotas mensuales explícitas para socios activos, pagos manuales parciales o totales y estado de cuenta. Una cuota congela importe y vencimiento al emitirse; los saldos derivan de cuotas y pagos válidos, sin suspensión automática de membresía ni vínculo con reservas. Owner/admin puede anular un pago con motivo, conservando el historial; staff no accede a información financiera.

El Sprint 6 incorpora localmente la **Escuela de tenis**: una persona existente puede tener perfil de profesor sin obtener permisos administrativos; las clases individuales o grupales admiten cero o más alumnos registrados, cupo y recurrencia semanal limitada a 12 ocurrencias. Cada clase usa la agenda única de canchas, por lo que una reserva, bloqueo u otra clase superpuesta se rechaza en PostgreSQL. No se incluyen liquidaciones, pagos docentes ni mensualidades de alumnos.
