/**
 * Built-in mini-app catalog ("App Store" source).
 *
 * Each sub-folder of CATALOG_DIR holding a valid manifest.json is published
 * at /miniapps/<folder>/ and listed by GET /api/catalog.
 */
import fs from 'node:fs';
import path from 'node:path';
import express, { type Router } from 'express';
import { validateManifest, type MiniAppManifest } from '@tvwebos/shared';
import { log } from '../core/log.js';

export interface CatalogEntry {
  manifest: MiniAppManifest;
  /** Absolute path (from the server origin) of the manifest file. */
  manifestUrl: string;
}

export function loadCatalog(dir: string): CatalogEntry[] {
  if (!fs.existsSync(dir)) return [];
  const out: CatalogEntry[] = [];
  for (const folder of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, folder, 'manifest.json');
    if (!/^[a-z0-9-]+$/.test(folder) || !fs.existsSync(file)) continue;
    try {
      const result = validateManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
      if (!result.ok) {
        log.warn('Skipping invalid catalog manifest', { folder, error: result.error });
        continue;
      }
      out.push({ manifest: result.manifest, manifestUrl: `/miniapps/${folder}/manifest.json` });
    } catch (err) {
      log.warn('Skipping unreadable catalog manifest', { folder, error: String(err) });
    }
  }
  return out;
}

export function catalogRouter(dir: string): { api: Router; files: Router } {
  const api = express.Router();
  api.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.json({ apps: loadCatalog(dir) });
  });

  const files = express.Router();
  files.use(
    express.static(dir, {
      dotfiles: 'deny',
      index: ['index.html'],
      setHeaders(res) {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
      },
    }),
  );
  return { api, files };
}
