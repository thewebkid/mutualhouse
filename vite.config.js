import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Local Vite middleware mounting the exact Hono server (`server/app.js`)
 * on `/api`, `/mcp`, `/oauth2`, and `/.well-known` so `npm run dev` mirrors
 * Vercel Fluid Compute Node 24 with zero separate backend process required.
 */
function honoDevPlugin() {
  let appPromise = null;

  const shouldHandle = (url = '') =>
    url.startsWith('/api/') ||
    url === '/api' ||
    url.startsWith('/mcp/') ||
    url === '/mcp' ||
    url.startsWith('/oauth2/') ||
    url.startsWith('/.well-known/');

  return {
    name: 'mutualhouse-hono-dev',
    configureServer(viteServer) {
      viteServer.middlewares.use(async (req, res, next) => {
        if (!shouldHandle(req.url)) return next();

        try {
          if (!appPromise) {
            appPromise = import('./server/app.js').then((m) => m.getApp());
          }
          const app = await appPromise;

          const proto = req.headers['x-forwarded-proto'] || 'http';
          const host = req.headers.host || 'localhost:5888';
          const fullUrl = `${proto}://${host}${req.url}`;

          const headers = new Headers();
          for (const [key, val] of Object.entries(req.headers)) {
            if (Array.isArray(val)) {
              for (const v of val) headers.append(key, v);
            } else if (val !== undefined) {
              headers.set(key, val);
            }
          }

          let body = undefined;
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            const chunks = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            body = Buffer.concat(chunks);
          }

          const fetchReq = new Request(fullUrl, {
            method: req.method,
            headers,
            body,
          });

          const fetchRes = await app.fetch(fetchReq);
          res.statusCode = fetchRes.status;
          fetchRes.headers.forEach((value, key) => {
            if (key.toLowerCase() === 'set-cookie') return;
            res.setHeader(key, value);
          });
          const setCookies = fetchRes.headers.getSetCookie?.() ?? [];
          if (setCookies.length) {
            res.setHeader('set-cookie', setCookies);
          }

          if (!fetchRes.body) {
            res.end();
            return;
          }
          const arrayBuf = await fetchRes.arrayBuffer();
          res.end(Buffer.from(arrayBuf));
        } catch (err) {
          console.error('[hono-dev]', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
          }
        }
      });
    },
  };
}

export default defineConfig({
  root: path.resolve(__dirname, 'client'),
  publicDir: path.resolve(__dirname, 'client/public'),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'client/src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  plugins: [
    vue(),
    honoDevPlugin(),
    VitePWA({
      registerType: 'autoUpdate',
      manifestFilename: 'manifest.webmanifest',
      manifest: {
        name: 'The Mutual House',
        short_name: 'Mutual House',
        description: 'A household-scale sanctuary for differentiated human and AI signatures.',
        theme_color: '#f8f6f3',
        background_color: '#f8f6f3',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/brand/house-mark.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api(\/|$)/,
          /^\/mcp(\/|$)/,
          /^\/oauth2(\/|$)/,
          /^\/\.well-known(\/|$)/,
        ],
      },
    }),
  ],
});
