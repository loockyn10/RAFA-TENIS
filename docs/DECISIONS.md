# DECISIONS.md — decisiones de arquitectura/producto

## D001 — PWA primero
**Decisión:** React + Vite + TypeScript como una sola interfaz responsive/PWA, Vercel + Supabase + GitHub, sin Docker ni Tauri al iniciar.
**Motivo:** velocidad de entrega, costo y menos superficies que mantener.
**Consecuencia:** no prometer publicación en App Store/Play Store ni operación transaccional offline.
**Estado:** implementado como base local en Sprint 0; Supabase, Vercel y GitHub remoto siguen propuestos/no configurados.

## D002 — Identidad de jugador independiente de login
**Decisión:** ficha de `player` sin obligación de Supabase Auth.
**Motivo:** Rafa debe atender a menores, visitantes o socios sin celular.
**Consecuencia:** la autorización se modela aparte; jugadores sin cuenta pueden tener reservas.
**Estado:** decisión funcional de diseño.

## D003 — Ocupación única y control en BD
**Decisión:** todas las actividades usan una sola fuente de ocupación de canchas; exclusión de intervalos en PostgreSQL.
**Motivo:** evitar turnos duplicados, incluso bajo concurrencia.
**Consecuencia:** clases y torneos futuros enlazan esta agenda, sin calendarios paralelos; slots contiguos permitidos.
**Estado:** decisión técnica para Sprint 2 (sin implementar).

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
