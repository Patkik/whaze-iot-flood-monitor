import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version || '2.0.0'),
    __APP_COMMIT_SHA__: JSON.stringify('ba17e5e'),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'critical-alarm.mp3'],
      manifest: {
        name: 'Whaze: Community and Evacuation Leading',
        short_name: 'Whaze',
        description:
          'IoT flood early warning and evacuation guide for Brgy. Narra and Brgy. Yakal, CSJDM, Bulacan.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#1d4ed8',
        icons: [
          { src: 'logo.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'logo.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
        shortcuts: [
          { name: 'Evacuation route', url: '/evacuate' },
          { name: 'SOS and hotlines', url: '/emergency' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,mp3}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/[a-c]\.tile\.openstreetmap\.org\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 14 },
            },
          },
        ],
      },
    }),
  ],
});
