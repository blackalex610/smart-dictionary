import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

/**
 * Mirrors the production headers in vercel.json / public/_headers so
 * `npm run preview` exercises the same Content-Security-Policy.
 */
const PREVIEW_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Умен Речник',
        short_name: 'Речник',
        description: 'Интерактивен инструмент за учене на нови думи',
        start_url: '/app',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2563eb',
        orientation: 'portrait-primary',
        lang: 'bg',
        dir: 'ltr',
        categories: ['education', 'productivity'],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\//],
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Pure-TS modules shared with the Edge Functions (no Deno APIs).
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
    },
  },
  server: { port: 5173 },
  preview: { port: 4173, headers: PREVIEW_HEADERS },
  // 'hidden': maps are generated for debugging but not referenced from the
  // shipped bundles. Delete dist/**/*.map before upload to keep them private.
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // Libraries change far less often than the app; separate chunks keep
        // them cached across deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('@tanstack')) return 'query'
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|@remix-run)[\\/]/.test(
              id,
            )
          ) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
})
