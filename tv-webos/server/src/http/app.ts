import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { PROTOCOL_VERSION } from '@tvwebos/shared';
import type { Config } from '../config.js';
import type { DeviceStore } from '../core/store.js';
import type { TokenSigner } from '../core/tokens.js';
import { catalogRouter } from './catalog.js';
import { filesRouter, type FilesDeps } from './files.js';

export const SERVER_VERSION = '0.1.0';

export interface AppDeps {
  config: Config;
  store: DeviceStore;
  signer: TokenSigner;
  onUpload: FilesDeps['onUpload'];
}

export function createApp(deps: AppDeps): Express {
  const { config } = deps;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', true);

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // The API authenticates with bearer tokens (never cookies), so allowing any
  // origin is safe and lets a packaged webOS app (file:// origin) call it.
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/info', (_req, res) => {
    res.json({ name: 'TV WebOS', version: SERVER_VERSION, protocol: PROTOCOL_VERSION });
  });

  const catalog = catalogRouter(config.catalogDir);
  app.use('/api/catalog', catalog.api);
  app.use('/miniapps', catalog.files);
  app.use('/api/files', filesRouter(deps));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ---- Static client ------------------------------------------------------
  const indexHtml = path.join(config.clientDir, 'index.html');
  const remoteHtml = path.join(config.clientDir, 'remote.html');
  // The desktop may be framed by the packaged webOS launcher (file:// origin), so it is not
  // marked X-Frame-Options; the phone remote page is.
  const sendHtml = (file: string, frameable: boolean) => (_req: express.Request, res: express.Response) => {
    if (!fs.existsSync(file)) {
      res
        .status(503)
        .type('text/plain')
        .send('Client is not built. Run "npm run build" in tv-webos/, or use "npm run dev" during development.');
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    if (!frameable) res.setHeader('X-Frame-Options', 'DENY');
    res.sendFile(file);
  };
  app.get(['/', '/index.html', '/tv'], sendHtml(indexHtml, true));
  app.get(['/remote', '/remote/', '/remote.html'], sendHtml(remoteHtml, false));
  app.use(
    express.static(config.clientDir, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );
  return app;
}
