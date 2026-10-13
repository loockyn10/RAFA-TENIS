# DECISIONS.md — decisiones de arquitectura/producto

## D001 — PWA primero
**Decisión:** React + Vite + TypeScript como una sola interfaz responsive/PWA, Vercel + Supabase + GitHub, sin Docker ni Tauri al iniciar.
**Motivo:** velocidad de entrega, costo y menos superficies que mantener.
**Consecuencia:** no prometer publicación en App Store/Play Store ni operación transaccional offline.
**Estado:** base local implementada en Sprint 0; el usuario informó que Supabase base fue configurado y probado manualmente. Vercel y la verificación de GitHub remoto siguen pendientes.

## D002 — Identidad de jugador independiente de login
**Decisión:** ficha de `player` sin obligación de Supabase Auth.
**Motivo:** Rafa debe atender a menores, visitantes o socios sin celular.
**Consecuencia:** la autorización se modela aparte; jugadores sin cuenta pueden tener reservas.
**Estado:** decisión funcional de diseño.

## D003 — Ocupación única y control en BD
**Decisión:** todas las actividades usan una sola fuente de ocupación de canchas; exclusión de intervalos en PostgreSQL.
**Motivo:** evitar turnos duplicados, incluso bajo concurrencia.
**Consecuencia:** clases y torneos futuros enlazan esta agenda, sin calendarios paralelos; slots contiguos permitidos.
**Estado:** migración local Sprint 2 implementada; aplicación y prueba remota pendientes.

## D004 — Separar reserva, uso y cargo/pago
**Decisión:** no registrar deuda automática al crear reserva; monetización posterior e independiente.
**Motivo:** Rafa puede cobrar horas diferentes a las utilizadas y el club opera informalmente.
**Consecuencia:** no inferir saldos desde reserva ni cantidad de jugadores.
**Estado:** decisión de producto.

## D005 — No inventar políticas del club
**Decisión:** horarios, duración mínima, anticipación, tarifa, cancelaciones y vencimiento de cuotas requieren aprobación de Rafa.
**Motivo:** condicionan UX, permisos, automatizaciones y datos.
**Consecuencia:** Sprint 0 puede ejecutarse sin esas definiciones; sprints de operación deberán resolverlas o dejar ajustes explícitos sin imponer restricciones.
**Estado:** decisión de proceso.

## D006 — Documentos canónicos y prompts pequeños
**Decisión:** `AGENTS.md` + `AI_WORKFLOW.md` + `docs/*.md` como fuente de verdad y contextos cortos para agentes.
**Motivo:** continuidad entre Codex/Claude sin chats gigantes.
**Consecuencia:** código actual indica implementación, docs registran intención, discrepancias se reportan.
**Estado:** decisión de proceso.

## D007 — Bootstrap administrativo explícito
**Decisión:** el club inicial, las seis canchas y el primer `owner` se crean con un script SQL idempotente ejecutado desde un mecanismo administrativo de Supabase, tras crear manualmente el usuario Auth.
**Motivo:** impedir que un visitante del frontend se autoasigne privilegios y conservar una trazabilidad simple de la configuración inicial.
**Consecuencia:** la primera puesta en funcionamiento requiere acceso administrativo a Supabase; el frontend nunca usa `service_role` ni crea membresías.
**Estado:** script y migración versionados; el usuario informó que la configuración base fue ejecutada y verificada manualmente. La evidencia reproducible de RLS sigue pendiente.

## D008 — Primera agenda operativa de reservas
**Decisión:** usar `reservations` con nombre libre de quien reserva, estado `confirmed`/`cancelled`, instantes `timestamptz` y exclusión GiST por cancha para confirmadas. Owner, admin y staff tienen la misma capacidad operativa, sin eliminación física.
**Motivo:** permitir una agenda rápida sin exigir una ficha ni una cuenta al jugador y conservar historial de cancelaciones, aun con operaciones simultáneas.
**Consecuencia:** la agenda se presenta inicialmente de 07:00 a 23:00 con grilla de 30 minutos, solo como decisión de interfaz. Horarios del club, duraciones, bloqueos y reglas de cancelación continúan pendientes de validación.
**Estado:** migración e interfaz locales versionadas; aplicación y prueba contra Supabase pendientes.

## D009 — Bloqueos y recurrencias en la misma agenda
**Decisión:** extender `reservations` con `occupation_type`, motivo de bloqueo y referencia opcional a `reservation_series`; no crear una tabla de bloqueos independiente. Las series semanales se crean mediante una función PostgreSQL atómica y quedan limitadas a 12 ocurrencias.
**Motivo:** reservas y bloqueos deben competir por la misma restricción temporal, y una serie no puede quedar parcialmente creada ante un conflicto concurrente.
**Consecuencia:** bloques activos (`active`) y reservas confirmadas (`confirmed`) integran una exclusión GiST común; cada ocurrencia sigue siendo editable/cancelable individualmente. La función usa `SECURITY DEFINER` solo para agrupar inserciones y comprueba usuario, club, `search_path` y permisos explícitos.
**Estado:** migración e interfaz Sprint 3 versionadas localmente; no aplicadas ni verificadas contra Supabase remoto.

## D010 — Ficha de persona y membresía separadas
**Decisión:** usar `club_people` para fichas sin Auth obligatorio y `club_memberships` para la condición active/inactive, separadas de `club_staff`. Las reservas guardan siempre `customer_name` y opcionalmente `person_id` validado dentro del mismo club.
**Motivo:** representar visitantes, menores y socios sin confundir identidad, acceso administrativo, membresía o deuda; conservar historial al editar una ficha.
**Consecuencia:** no se deducen cuotas/cobros de membresía. Staff opera fichas pero no membresías; owner/admin las administra. No hay bajas físicas desde cliente.
**Estado:** migración e interfaz Sprint 4 versionadas localmente; no aplicadas ni verificadas contra Supabase remoto.

## D011 — Cuotas como obligaciones inmutables y pagos auditables
**Decisión:** modelar configuración vigente, cuotas por período y pagos separados; calcular saldo desde movimientos válidos. La emisión es explícita y transaccional, y anular un pago exige motivo y preserva el registro.
**Motivo:** evitar que modificar el importe mensual cambie historia, no inferir deuda desde reservas, y proteger cobros parciales/concurrentes.
**Consecuencia:** no hay saldo mutable, pagos anticipados, suspensión por deuda ni eliminación física. Los montos se guardan como centavos enteros ARS; owner/admin es el único acceso financiero.
**Estado:** migración e interfaz Sprint 5 versionadas localmente; no aplicadas ni verificadas contra Supabase remoto.
