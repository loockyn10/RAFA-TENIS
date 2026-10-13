# AI_WORKFLOW.md — metodología multiagente

**Roles:** ChatGPT define producto, UX, arquitectura, riesgos y sprints; Codex implementa tareas acotadas y conocidas; Claude Code se favorece ante incertidumbre, exploración, seguridad o revisión amplia. No usar ambos en cada sprint por rutina.

**Contextos:** usar 1–3 prompts sustanciales por chat de agente: sprint → corrección/review → cierre. Al cambiar de feature, abrir contexto nuevo. La memoria permanente es repo + docs, no chat.

**Inicio de sprint:** inspeccionar `git status`, leer docs pertinentes, localizar símbolos/archivos/tareas, revisar dependencias inmediatas y tests. Evitar leer el repositorio entero salvo auditoría justificada.

**Prompts:** objetivo, alcance, reglas permanentes, UX/backend/seguridad según aplique, criterios de aceptación, pruebas y reporte final. No repetir documentación entera que ya existe en repo.

**Trabajo simultáneo:** agentes que escriban código deben tener `branch + git worktree` independientes; no editar el mismo working tree concurrentemente. Ante cambios relacionados, trabajar secuencialmente.

**Entrega / control:** reporte con archivos, pruebas y limitaciones; revisión de diffs, datos y migraciones antes de integración. `commit`, `push`, `merge` y despliegue NO automáticos. Una branch subida a GitHub no implica despliegue en producción.

**Documentación:** producto → `PRODUCT`, arquitectura → `ARCHITECTURE`, estado real → `CURRENT_STATE`, decisión irreversible/importante → `DECISIONS`, prioridades → `ROADMAP`, bugs y pendientes → `TASKS`. Evitar historias eternas/duplicadas.

**Separación estricta:** 'migration existe' no implica 'aplicada'; '.env.example existe' no implica '.env.local configurado'; 'build pasa' no implica 'probado en producción'.
