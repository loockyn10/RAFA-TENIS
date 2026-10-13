# Rafa Tenis

PWA de administración inicial para Rafa Tenis. Incluye acceso administrativo con Supabase y configuración de canchas; no incluye calendario ni reservas.

## Requisitos

- Node.js 20.19 o superior.
- pnpm 9.6 o superior. Si no está disponible: `corepack enable` y `corepack prepare pnpm@9.6.0 --activate`.

## Instalación y ejecución

```bash
pnpm install
pnpm dev
```

Vite mostrará la dirección local. Para probar desde un celular conectado a la misma red, iniciá con `pnpm dev -- --host` y abrí la URL de red que informe Vite. El acceso desde otro dispositivo depende del firewall y de la red local.

La instalación de la PWA se habilita en navegadores compatibles cuando se sirve en un contexto seguro (HTTPS), o en `localhost`. Una prueba desde la IP local puede requerir HTTPS para mostrar la instalación; no hay sincronización offline ni datos privados en caché.

## Calidad

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Los scripts se ejecutan en `apps/web` mediante el workspace. `pnpm build` genera los artefactos locales en `apps/web/dist/`; no implica un despliegue en Vercel.

## Configuración de Supabase

1. Creá un proyecto Supabase y habilitá Email/Password en Authentication.
2. Copiá `.env.example` como `.env.local` en la raíz del repositorio.
3. En el panel de Supabase, copiá la URL del proyecto y su **Publishable key** en `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Aplicá `supabase/migrations/20261013000000_club_access_and_courts.sql` desde un mecanismo administrativo seguro (por ejemplo, SQL Editor). La migración no se aplica automáticamente desde el frontend.
5. Creá manualmente el primer usuario en Authentication > Users. Copiá su UUID real, reemplazá `REPLACE_WITH_AUTH_USER_UUID` en `supabase/bootstrap/rafa-tenis.sql` y ejecutalo desde SQL Editor.
6. Iniciá sesión con ese email y contraseña. Deben verse las seis canchas de Rafa Tenis.

`apps/web/vite.config.ts` carga las variables desde la raíz del repositorio. Estas dos variables son públicas para el cliente: nunca agregues `service_role`, contraseñas ni otros secretos al archivo.

El bootstrap es idempotente para un club vacío: crea Rafa Tenis, asocia explícitamente el owner y carga seis canchas. Si ya existen entre una y cinco canchas, se detiene sin pisar ni duplicar datos. Las verificaciones de RLS reproducibles están en `supabase/verification/rls-checks.sql`.

## Estructura

```text
apps/web/       Aplicación React + Vite + PWA
docs/           Contexto, decisiones, estado y trabajo pendiente
```

Las reglas y el alcance vigente están en `AGENTS.md` y `docs/`.
