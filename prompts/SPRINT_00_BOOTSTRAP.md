# SPRINT 00 — Bootstrap técnico + documentación multiagente

**AGENTE RECOMENDADO:** Codex
**NIVEL RECOMENDADO:** Medio
**CONTEXTO:** NUEVO
**MOTIVO:** implementación acotada y bien especificada; no hay backend sensible ni reglas de negocio que implementar todavía.

---

Actuá como implementador del Sprint 0 de **Rafa Tenis** en este repositorio. Tu objetivo es dejar una base técnica limpia que pueda abrirse localmente, probarse y continuar con sprints posteriores, **sin construir todavía la agenda real ni inventar reglas de Rafa**.

## Preparación obligatoria
1. Leé `AGENTS.md`, `AI_WORKFLOW.md`, `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, `docs/CURRENT_STATE.md`, `docs/ROADMAP.md` y `docs/TASKS.md`; consultá `docs/PRODUCT.md` si necesitás definir textos de UI.
2. Inspeccioná `git status` y los archivos reales. Si ya hay código, adaptá sin destruirlo; no repitas scaffold que ya exista.
3. Este repositorio y sus docs son fuente de verdad. No asumas que hay Supabase/GitHub/Vercel configurados ni secretos disponibles.

## Objetivo / alcance
- Inicializar pnpm workspace mínimo con `apps/web` (React + Vite + TypeScript estricto); packages compartidos **solo si existe necesidad real**, no por plantilla.
- Estructurar una PWA **instalable** (manifest, íconos válidos y configuración razonable de service worker) sin prometer operaciones offline ni cachear datos privados.
- Crear interfaz base responsive y accesible, con identidad provisional **Rafa Tenis** y pantalla de inicio que comunique claramente **«Base técnica — sin reservas operativas todavía»**. No simular datos reales ni login funcional.
- Organizar componentes/carpeta de forma ligera, preparada para agenda y usuarios posteriores, sin arquitectura compleja.
- Configurar scripts reproducibles `dev`, `typecheck`, `lint`, `test`, `build` con ejemplos mínimos de pruebas reales y configuración adecuada de TypeScript/lint.
- Versionar `.gitignore` que excluya `.env.local`, artefactos, dependencias y secretos; `.env.example` sin claves reales con variables públicas previstas de Supabase (si se mencionan) y README de instalación/uso con pnpm **sin Docker**.
- Preservar documentos canónicos existentes y actualizarlos solo donde cambie información fáctica. `docs/CURRENT_STATE.md` debe separar creado/ejecutado/verificado de pendiente; `docs/TASKS.md` debe reflejar próximos pasos. No crear archivos de handoff duplicados ni hacer un historial infinito.

## Fuera de alcance — estricto
- NO tablas, migraciones, seed, RLS, roles/auth real, cuentas/credenciales, Supabase remoto, Vercel deploy.
- NO calendario funcional, creación de reservas, cuotas, docentes, torneos, cantina ni pagos.
- NO imponer horarios, duraciones, cupos, restricciones ni tarifas como datos confirmados.
- NO implementar Supabase service_role en cliente ni secretos.
- NO usar Docker ni Tauri; no hacer `commit`, `push`, `merge` o SQL remoto sin autorización.

## Calidad / aceptación
1. Proyecto instalable y ejecutable local con instrucciones claras.
2. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pasan, o explicar fallas reales con trazas y resolverlas en alcance.
3. PWA identificable e instalable en condiciones soportadas (si falta verificación manual, declararlo).
4. Pantallas responsivas y navegables con teclado; no vender la demo como producto funcional.
5. Sin credenciales, datos productivos, backend remoto ni migraciones creadas.
6. Archivos canónicos y estado documental coherentes con el repo al final.

## Reporte de salida (breve)
- Qué hiciste; archivos/carpetas principales.
- Comandos de test/build y resultados; verificaciones manuales realizadas versus no realizadas.
- Cómo instalar, correr y abrir desde PC/celular localmente (avisar requisito de HTTPS/conectividad/red si aplica).
- Infraestructura real disponible y faltante.
- Qué no está implementado.
- Siguiente sprint recomendado (Auth/admin + seis canchas), **sin iniciarlo**.
