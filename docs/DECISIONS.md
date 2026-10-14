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

## D012 — Clase como entidad vinculada a la agenda única
**Decisión:** una clase es `tennis_lessons` y se vincula obligatoriamente a una ocupación `reservations` de tipo `lesson`; no duplica cancha ni horario. Los alumnos enlazan con `club_people` y el profesor con `club_coaches`.
**Motivo:** distinguir el negocio de la escuela de una reserva común sin abrir una agenda paralela ni duplicar fichas personales.
**Consecuencia:** las clases se crean, editan y cancelan mediante RPC atómicas; la exclusión GiST de agenda cubre sus canchas y el profesor se serializa por lock asesorado. Profesor no concede acceso administrativo.
**Estado:** migración e interfaz Sprint 6 versionadas localmente; no aplicadas ni verificadas contra Supabase remoto.

## D013 — Fixture de eliminación directa y agenda compartida
**Decisión:** los torneos usan categorías Singles/Dobles, inscripciones desde `club_people` y cuadro de eliminación directa de 2–32 participantes. Los BYE avanzan automáticamente y un partido ocupa cancha mediante una reserva `tournament_match` creada sólo por RPC.
**Motivo:** preservar historial, evitar duplicados/avances incoherentes y mantener una única protección GiST para reserva, bloqueo, clase y partido.
**Consecuencia:** owner/admin modifica estructura; staff programa y registra resultados. No hay zonas, ranking, siembra ni corrección de cuadros avanzados.
**Estado:** migración e interfaz Sprint 7 versionadas localmente; no aplicadas ni verificadas contra Supabase remoto.

## D014 — Cantina con ventas inmutables y saldo derivado
**Decisión:** usar catálogo por club, ventas confirmadas con ítems/precios históricos y pagos separados por venta. El saldo de cantina se deriva de `total_cents - pagos`; no se reutilizan cuotas ni se guarda un saldo mutable como fuente de verdad.
**Motivo:** permitir una venta inmediata anónima, consumos pendientes atribuibles por ID y cobros parciales sin que una variación de precio reescriba la historia.
**Consecuencia:** confirmar una venta se hace exclusivamente mediante RPC atómica e idempotente; pending exige persona del mismo club, sobrepagos se rechazan con lock y una anulación solo es posible sin pagos, con motivo auditado. Stock, fiscalización, caja formal y devoluciones quedan fuera.
**Estado:** migración e interfaz Sprint 8 versionadas localmente; no aplicadas ni verificadas contra Supabase remoto.

## D015 — Portal del jugador por vínculo autorizado e invitación de un uso
**Decisión:** vincular Auth con `club_people` por club exclusivamente al canjear una invitación individual hasheada. Exponer perfil, cuotas, torneos, disponibilidad y reservas mediante RPC acotadas; no ampliar acceso directo a tablas privadas.
**Motivo:** una ficha no equivale a cuenta digital y nombres/contactos no demuestran identidad. El portal necesita datos propios sin heredar permisos de `club_staff`.
**Consecuencia:** una cuenta puede tener una ficha por club y participar en varios clubes; una cuenta que también es staff cambia explícitamente de experiencia. La reserva online valida configuración y límites en PostgreSQL, con GiST como defensa final. La dirección email de contacto no modifica Auth.
**Estado:** migración e interfaz Sprint 09 versionadas localmente; no aplicadas ni verificadas contra Supabase remoto.

## D017 — Estabilización del fixture de torneos (Sprint 10A)
**Decisión:** corregir `generate_tournament_fixture` y `record_tournament_match_result` en una migración nueva, conservando `tournament_matches_next_target` (un destino exige partido y casillero a la vez; la final no tiene destino). La generación crea cada partido con su destino ya definido y verifica `inscripciones - 1` partidos; el resultado exige ambos participantes y compara el ganador explícitamente (sin `NOT IN` con NULL). Se agregan garantías de tabla: ganador participante y finalizado con ambos participantes (ambas `NOT VALID`), casillero siguiente único y un trigger que exige misma categoría/ronda inmediata y participantes de la categoría.
**Motivo:** el error provenía de la función (cuadro de una sola ronda), no de la constraint; relajarla habría ocultado datos inconsistentes. Las constraints `NOT VALID` no bloquean instalaciones con filas generadas por el código anterior y no se regeneran fixtures existentes.
**Consecuencia:** se elimina el bloqueo por "rondas posteriores finalizadas" (rompía cuadros con BYE); el avance sigue protegido por el casillero ocupado y el estado del partido siguiente.
**Estado:** migración versionada y verificada en PostgreSQL local descartable; no aplicada ni verificada en Supabase remoto.

## D018 — Identidad institucional verde y shell móvil compacto
**Decisión:** la interfaz usa una identidad predominantemente verde con tokens semánticos para superficies, texto, acciones, estados y foco; amarillo tenis queda reservado para acciones/foco destacados y terracota para detalles secundarios. En experiencias autenticadas, el encabezado se reduce a escudo, Rafa Tenis y acceso de cuenta; la información de sesión, cambio de club, cambio de experiencia y cierre de sesión se agrupan en ese acceso.
**Motivo:** reflejar la identidad deportiva real del club, mejorar contraste bajo luz exterior y recuperar altura útil en móviles sin perder los controles disponibles.
**Consecuencia:** las estadísticas generales solo aparecen en Inicio; la navegación inferior móvil reserva espacio mediante altura dinámica y `safe-area`, mientras modales y menú Más mantienen capas superiores. Los componentes funcionales conservan sus flujos y solo adoptan tokens/superficies del sistema.
**Estado:** implementado localmente en Sprint 11A; pendiente recorrido visual autenticado en dispositivos y tamaños objetivo.
