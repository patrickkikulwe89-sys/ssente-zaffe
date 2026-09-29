import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The trust list is compiled in: the app must be able to verify with no network at all. */
const trustedFile = JSON.parse(readFileSync(resolve(__dirname, '../../keys/trusted.json'), 'utf8')) as
  Record<string, { issuer: string; publicKey: string }>;

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Ssente Zaffe — our money',
        short_name: 'Ssente Zaffe',
        description: 'Verify what your district was budgeted, offline.',
        theme_color: '#0f766e',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
      },
      workbox: {
        // Precache the shell and the 21 KB district index only. District bundles are
        // cached on demand, so a first visit never downloads the whole country.
        globPatterns: ['**/*.{js,css,html,svg}', 'bundles/index.json'],
        runtimeCaching: [{
          urlPattern: /\/bundles\/\d{3}\.json$/,
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'district-bundles', expiration: { maxEntries: 40 } },
        }],
      },
    }),
  ],
  resolve: { alias: { '@core': resolve(__dirname, '../../packages/core/src') } },
  define: { __TRUSTED__: JSON.stringify(trustedFile) },
  server: { fs: { allow: [resolve(__dirname, '../..')] } },
  build: { target: 'es2020' },
});
