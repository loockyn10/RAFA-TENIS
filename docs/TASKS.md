# TASKS.md — pendientes activos (no historial)

## Prioridad P0
- [ ] Crear repo privado GitHub y confirmar quién es dueño y quién tiene acceso.
- [x] Sprint 0: scaffold pnpm/React/Vite/TS/PWA + calidad y docs (validación de comandos pendiente de registrar según ejecución real).
- [ ] Revisar con Rafa las **10 preguntas críticas** en `VALIDACION_RAFA.md` antes de automatizar restricciones del calendario.
- [ ] Acordar con Rafa titularidad de cuentas, costos de hosting/dominio y alcance del soporte.
- [ ] Configurar un proyecto Supabase en región adecuada y definir quién tendrá acceso administrativo.
- [ ] Aplicar la migración Sprint 1, crear el primer usuario Auth y ejecutar el bootstrap seguro de Rafa Tenis.
- [ ] Ejecutar `supabase/verification/rls-checks.sql` con usuarios reales de prueba y registrar los resultados.
- [ ] Antes de Sprint 2: revisar modelado de reserva/ocupación, RLS, aislamiento de club y exclusión de intervalos; verificar tests con BD real.

## P1/P2 (no tomar ahora)
- [ ] Acordar reglas de cuotas, profesores, torneos y cantina cuando llegue su sprint.
- [ ] Revisar política de backup/restore y operación si no hay conexión antes del piloto.

## Riesgos
- Cambiar el alcance al desarrollar (añadir POS, cobros, torneos prematuramente).
- Tomar precios/horarios de ejemplo como confirmados.
- Migración versionada sin aplicar, o aplicada manualmente sin reflejar estado documental.
- Confundir PWA instalable con POS offline-first.
