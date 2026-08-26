import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

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
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
})
