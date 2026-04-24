// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'   // ✅ NUEVO

const HMR_HOST = process.env.HMR_HOST

const ALLOWED = [
  '.trycloudflare.com',
  '.ema.com.py',
  'app.ema.com.py',
  'www.ema.com.py',
  'ema.com.py',
  'localhost',
  '127.0.0.1',
]

const isApiExportDownload = (pathname) =>
  /^\/api\/.+\/(docx|docx-rango-unico|pdf|excel|kmz)$/i.test(pathname)

export default defineConfig({
  plugins: [
    react(),

    // ✅ PWA / OFFLINE
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'], // si tenés más íconos, los agregás acá
      manifest: {
        name: 'EMA Encuestas',
        short_name: 'Encuestas',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: '/Ema_Foco_Logo.png', sizes: '192x192', type: 'image/png' },
          { src: '/Ema_Foco_Logo.png', sizes: '512x512', type: 'image/png' },
        ],
      },

      // ✅ Lo más importante: que al recargar OFFLINE cargue el index desde cache
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB
        navigateFallback: '/index.html',
        runtimeCaching: [
          // Assets (js/css)
          {
            urlPattern: ({ request }) =>
              request.destination === 'script' ||
              request.destination === 'style' ||
              request.destination === 'worker',
            handler: 'CacheFirst',
            options: { cacheName: 'assets' },
          },

          // Navegación (rutas React)
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'pages' },
          },

          // API (ajustá si tu API no cuelga del mismo host)
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith('/api/') && !isApiExportDownload(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'api', networkTimeoutSeconds: 5 },
          },
        ],
      },
    }),
  ],

  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },

  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
    allowedHosts: ALLOWED,
    ...(HMR_HOST ? { hmr: { host: HMR_HOST, protocol: 'wss', clientPort: 443 } } : {}),
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    emptyOutDir: true,
  },

  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
