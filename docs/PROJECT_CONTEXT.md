# PROJECT_CONTEXT.md

**Qué:** Rafa Tenis es una PWA de gestión operativa para un club de tenis de Argentina. Se prioriza el calendario de **seis canchas de polvo de ladrillo** y, por fases, fichas y cuotas, profesores, torneos, eventos y cantina.

**Quiénes:** Rafa/administradores, personal autorizado, profesores, socios y visitantes; no todos tienen o quieren cuentas digitales.

**Problema:** coordinar reservas y administración de un club de trato cercano sin duplicar turnos ni exigir burocracia o pagos inmediatos.

**Producto inicial:** agenda rápida y clara para que Rafa cargue reservas de personas con o sin cuenta desde PC o celular.

**Stack propuesto:** GitHub, pnpm, React + Vite + TypeScript, PWA, Supabase Auth + PostgreSQL/RLS, Vercel. Sin Docker ni Tauri.

**Invariantes:** ficha persona distinta de identidad Auth; una sola agenda de ocupación por cancha; reserva ≠ tiempo jugado ≠ cobro; servidor/DB autoriza y evita solapes.

**Estado:** existen Auth administrativo, clubes, seis canchas y su configuración en el repositorio; el usuario informó haberlos verificado manualmente contra Supabase. El Sprint 02 agrega localmente la agenda diaria y una migración de reservas pendiente de aplicar. Reglas operativas definitivas en `VALIDACION_RAFA.md` aún sin confirmar.
