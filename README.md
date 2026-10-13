# Rafa Tenis

Base técnica de una futura PWA para la gestión operativa de Rafa Tenis. Este repositorio es un prototipo en desarrollo: no contiene autenticación, conexión a Supabase, calendario ni reservas operativas.

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

## Configuración futura

Copiá `.env.example` a `.env.local` solo cuando un sprint posterior configure Supabase. Las variables listadas son públicas para el cliente; nunca incluir claves de servicio ni secretos en ellas. No hay infraestructura remota configurada por este repositorio.

## Estructura

```text
apps/web/       Aplicación React + Vite + PWA
docs/           Contexto, decisiones, estado y trabajo pendiente
```

Las reglas y el alcance vigente están en `AGENTS.md` y `docs/`.
