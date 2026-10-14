/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Prototipo aislado: no carga variables de entorno, no usa Supabase y no comparte build con apps/web.
// El escudo original se lee directamente desde apps/web para no duplicar el activo de marca.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@brand': fileURLToPath(new URL('../web/public/branding', import.meta.url)),
    },
  },
  server: { port: 5180, strictPort: false },
  preview: { port: 5181 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
