import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The trust list is compiled in: the app must be able to verify with no network at all. */
const trustedFile = JSON.parse(readFileSync(resolve(__dirname, '../../keys/trusted.json'), 'utf8')) as
  Record<string, { issuer: string; publicKey: string }>;

/**
 * GitHub Pages serves the site from a repository subpath, so the base has to be explicit:
 * the service worker scope and the web manifest are both resolved against it.
 */
const BASE = process.env.BASE_PATH ?? '/';

/**
 * Content Security Policy, delivered as a meta tag.
 *
 * Static hosting (GitHub Pages, a copy on a memory card) cannot set response headers, and a
 * meta policy is honoured for everything except `frame-ancestors`, which needs a real header.
 * The app has no inline scripts or inline styles, so nothing here needs 'unsafe-inline'.
 * `connect-src` is widened only to the reports service actually configured for this build.
 */
function cspPlugin() {
  const reports = (process.env.VITE_REPORTS_URL ?? '').trim();
  let connect = "'self'";
  if (reports) {
    try { connect += ` ${new URL(reports).origin}`; } catch { /* malformed: leave it out */ }
  }
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'ssente-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace('<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">\n    <meta name="referrer" content="no-referrer">`);
    },
  };
}

export default defineConfig({
  base: BASE,
  plugins: [
    cspPlugin(),
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
        start_url: BASE,
        scope: BASE,
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
