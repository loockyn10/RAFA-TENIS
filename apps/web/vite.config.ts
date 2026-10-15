import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  envDir: '../..',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Rafa Tenis',
        short_name: 'Rafa Tenis',
        description: 'Herramienta en desarrollo para la gestión de Rafa Tenis.',
        theme_color: '#0b3a2b',
        background_color: '#f7f4ed',
        display: 'standalone',
        lang: 'es-AR',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
        // Web Push (Sprint 15): se EXTIENDE el Service Worker generado, no se crea otro. push-sw.js se carga con importScripts dentro de sw.js.
        importScripts: ['push-sw.js'],
        globIgnores: ['push-sw.js'],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Bibliotecas estables en su propio archivo: se cachean aparte y no se vuelven a descargar con cada cambio de la aplicación.
        manualChunks: { react: ['react', 'react-dom'], supabase: ['@supabase/supabase-js'] },
      },
    },
  },
})
