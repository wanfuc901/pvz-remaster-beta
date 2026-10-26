import { resolve } from 'node:path';
import legacy from '@vitejs/plugin-legacy';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const SERVER = process.env.TVWEBOS_SERVER ?? 'http://127.0.0.1:8686';

/**
 * Browser targets:
 * - LG webOS 5.0 (2020) ships Chromium 68; it is the oldest TV engine we support.
 * - iOS Safari 13+ and Android Chrome for the phone remote.
 * Syntax is down-levelled by esbuild; missing runtime APIs are polyfilled per
 * use by plugin-legacy (modernPolyfills). No separate legacy (nomodule) bundle
 * is emitted: engines without ES modules get a short notice from index.html.
 */
const targets = ['chrome >= 68', 'safari >= 13', 'ios >= 13'];

/** Dev server: serve remote.html at /remote like the production server does. */
const remoteRoute: Plugin = {
  name: 'tvwebos-remote-route',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/remote\/?(\?|#|$)/.test(req.url)) req.url = req.url.replace(/^\/remote\/?/, '/remote.html');
      next();
    });
  },
};

export default defineConfig({
  // Relative base so the same build works from the server and from a packaged webOS app (file://).
  base: './',
  plugins: [
    react(),
    remoteRoute,
    legacy({ modernTargets: targets, modernPolyfills: true, renderLegacyChunks: false }),
  ],
  build: {
    cssTarget: ['chrome68', 'safari13'],
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        remote: resolve(__dirname, 'remote.html'),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
      '/api': SERVER,
      '/miniapps': SERVER,
    },
  },
});
