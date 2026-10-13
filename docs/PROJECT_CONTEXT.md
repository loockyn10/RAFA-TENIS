# PROJECT_CONTEXT.md

**Qué:** Rafa Tenis es una PWA de gestión operativa para un club de tenis de Argentina. Se prioriza el calendario de **seis canchas de polvo de ladrillo** y, por fases, fichas y cuotas, profesores, torneos, eventos y cantina.

**Quiénes:** Rafa/administradores, personal autorizado, profesores, socios y visitantes; no todos tienen o quieren cuentas digitales.

**Problema:** coordinar reservas y administración de un club de trato cercano sin duplicar turnos ni exigir burocracia o pagos inmediatos.

**Producto inicial:** agenda rápida y clara para que Rafa cargue reservas de personas con o sin cuenta desde PC o celular.

**Stack propuesto:** GitHub, pnpm, React + Vite + TypeScript, PWA, Supabase Auth + PostgreSQL/RLS, Vercel. Sin Docker ni Tauri.

**Invariantes:** ficha persona distinta de identidad Auth; una sola agenda de ocupación por cancha; reserva ≠ tiempo jugado ≠ cobro; servidor/DB autoriza y evita solapes.

**Estado:** existe un bootstrap local de React/Vite/TypeScript y PWA en `apps/web`, sin backend ni operación de club. Reglas operativas en `VALIDACION_RAFA.md` aún sin confirmar.
