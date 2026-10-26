/**
 * Media library API over MEDIA_DIR.
 *
 * - TVs may browse, stream and (unless FILES_READONLY) manage files.
 * - Remotes may upload into "Uploads/" only ("send to TV").
 * - Streaming uses signed URLs because <video>/<img> cannot send headers.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import express, { type Request, type Response, type Router } from 'express';
import type { Config } from '../config.js';
import { log } from '../core/log.js';
import type { DeviceStore } from '../core/store.js';
import type { TokenSigner } from '../core/tokens.js';
import { requireAuth } from './auth.js';
import { PathError, fileKind, normalizeRel, resolveInside, sanitizeFileName, uniquePath, type FileKind } from './paths.js';

export const UPLOAD_DIR = 'Uploads';
const INDEX_LIMIT = 5000;
const INDEX_TTL_MS = 30_000;

export interface FileEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  kind: FileKind | 'dir';
  size: number;
  mtime: number;
  /** Signed streaming URL (files only), relative to the server origin. */
  url?: string;
}

export interface FilesDeps {
  config: Config;
  store: DeviceStore;
  signer: TokenSigner;
  onUpload: (tvId: string, from: string, name: string, relPath: string, size: number) => void;
}

export function filesRouter(deps: FilesDeps): Router {
  const { config, signer, store } = deps;
  const router = express.Router();
  const tvOnly = requireAuth(signer, store, ['tv']);
  const anyClient = requireAuth(signer, store, ['tv', 'remote']);
  const indexCache = new Map<string, { at: number; entries: FileEntry[] }>();

  fs.mkdirSync(path.join(config.mediaDir, UPLOAD_DIR), { recursive: true });

  const toEntry = (rel: string, stat: fs.Stats): FileEntry => {
    const name = path.posix.basename(rel) || 'Media';
    if (stat.isDirectory()) {
      return { name, path: rel, type: 'dir', kind: 'dir', size: 0, mtime: stat.mtimeMs };
    }
    const { exp, sig } = signer.signMedia(rel);
    const url = `/api/files/raw?path=${encodeURIComponent(rel)}&exp=${exp}&sig=${sig}`;
    return { name, path: rel, type: 'file', kind: fileKind(name), size: stat.size, mtime: stat.mtimeMs, url };
  };

  const writable = (res: Response): boolean => {
    if (config.filesReadonly) {
      res.status(403).json({ error: 'The media library is read-only on this server (FILES_READONLY)' });
      return false;
    }
    return true;
  };

  router.get('/info', anyClient, (_req, res) => {
    res.json({ readonly: config.filesReadonly, uploadDir: UPLOAD_DIR, maxUploadBytes: config.maxUploadBytes });
  });

  router.get('/list', tvOnly, async (req, res) => {
    const rel = normalizeRel(req.query.path);
    const abs = resolveInside(config.mediaDir, rel);
    const stat = await fsp.stat(abs);
    if (!stat.isDirectory()) throw new PathError('Not a directory');
    const names = await fsp.readdir(abs);
    const entries: FileEntry[] = [];
    for (const name of names) {
      if (name.startsWith('.')) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      try {
        const childAbs = resolveInside(config.mediaDir, childRel);
        entries.push(toEntry(childRel, await fsp.stat(childAbs)));
      } catch {
        // Broken symlink or a link pointing outside MEDIA_DIR: hide it.
      }
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.type === 'dir' ? -1 : 1));
    res.json({ path: rel, readonly: config.filesReadonly, entries });
  });

  /** Recursive listing of one kind of media (for Gallery / Media library). */
  router.get('/index', tvOnly, async (req, res) => {
    const kind = String(req.query.kind ?? '');
    if (!['image', 'video', 'audio'].includes(kind)) throw new PathError('kind must be image, video or audio');
    const cached = indexCache.get(kind);
    if (cached && Date.now() - cached.at < INDEX_TTL_MS) {
      res.json({ entries: cached.entries, truncated: cached.entries.length >= INDEX_LIMIT });
      return;
    }
    const out: FileEntry[] = [];
    const walk = async (rel: string, depth: number): Promise<void> => {
      if (depth > 12 || out.length >= INDEX_LIMIT) return;
      let names: string[];
      try {
        names = await fsp.readdir(resolveInside(config.mediaDir, rel));
      } catch {
        return;
      }
      for (const name of names) {
        if (name.startsWith('.') || out.length >= INDEX_LIMIT) continue;
        const childRel = rel ? `${rel}/${name}` : name;
        let stat: fs.Stats;
        try {
          stat = await fsp.stat(resolveInside(config.mediaDir, childRel));
        } catch {
          continue;
        }
        if (stat.isDirectory()) await walk(childRel, depth + 1);
        else if (fileKind(name) === kind) out.push(toEntry(childRel, stat));
      }
    };
    await walk('', 0);
    out.sort((a, b) => b.mtime - a.mtime);
    indexCache.set(kind, { at: Date.now(), entries: out });
    res.json({ entries: out, truncated: out.length >= INDEX_LIMIT });
  });

  router.get('/raw', (req, res) => {
    const rel = normalizeRel(req.query.path);
    const exp = Number(req.query.exp);
    const sig = String(req.query.sig ?? '');
    if (!signer.verifyMedia(rel, exp, sig)) {
      res.status(403).json({ error: 'Link expired or invalid' });
      return;
    }
    const abs = resolveInside(config.mediaDir, rel);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.sendFile(abs, { dotfiles: 'deny', acceptRanges: true }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  router.post('/mkdir', tvOnly, express.json({ limit: '8kb' }), async (req, res) => {
    if (!writable(res)) return;
    const rel = normalizeRel(req.body?.path);
    if (!rel) throw new PathError('Path required');
    const abs = resolveInside(config.mediaDir, rel, false);
    await fsp.mkdir(abs);
    indexCache.clear();
    res.json({ ok: true });
  });

  router.post('/rename', tvOnly, express.json({ limit: '8kb' }), async (req, res) => {
    if (!writable(res)) return;
    const rel = normalizeRel(req.body?.path);
    if (!rel) throw new PathError('Cannot rename the root folder');
    const name = sanitizeFileName(String(req.body?.name ?? ''));
    const from = resolveInside(config.mediaDir, rel);
    const targetRel = path.posix.join(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), name);
    const to = resolveInside(config.mediaDir, targetRel, false);
    if (fs.existsSync(to)) throw new PathError('A file with that name already exists', 409);
    await fsp.rename(from, to);
    indexCache.clear();
    res.json({ ok: true, path: targetRel });
  });

  router.post('/delete', tvOnly, express.json({ limit: '8kb' }), async (req, res) => {
    if (!writable(res)) return;
    const rel = normalizeRel(req.body?.path);
    if (!rel || rel === UPLOAD_DIR) throw new PathError('This folder cannot be deleted');
    const abs = resolveInside(config.mediaDir, rel);
    await fsp.rm(abs, { recursive: true });
    indexCache.clear();
    res.json({ ok: true });
  });

  /** Raw-body upload: PUT /api/files/upload?name=photo.jpg */
  router.put('/upload', anyClient, async (req: Request, res: Response) => {
    const principal = req.principal!;
    const name = sanitizeFileName(String(req.query.name ?? ''));
    const declared = Number(req.headers['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared > config.maxUploadBytes) {
      res.status(413).json({ error: `File too large (max ${Math.round(config.maxUploadBytes / 1048576)} MB)` });
      return;
    }
    const dir = resolveInside(config.mediaDir, UPLOAD_DIR);
    const finalPath = uniquePath(dir, name);
    const tmp = `${finalPath}.part-${process.pid}-${Date.now()}`;
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > config.maxUploadBytes) cb(new PathError('File too large', 413));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(req, limiter, fs.createWriteStream(tmp, { flags: 'wx' }));
      await fsp.rename(tmp, finalPath);
    } catch (err) {
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    indexCache.clear();
    const relPath = `${UPLOAD_DIR}/${path.basename(finalPath)}`;
    const fromName =
      principal.role === 'remote' ? (store.findRemote(principal.tvId, principal.subject)?.name ?? 'Remote') : 'TV';
    log.info('File uploaded', { tvId: principal.tvId, path: relPath, bytes: received });
    deps.onUpload(principal.tvId, fromName, path.basename(finalPath), relPath, received);
    res.json({ ok: true, path: relPath, size: received });
  });

  router.use((err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (err instanceof PathError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') res.status(404).json({ error: 'Not found' });
    else if (code === 'EEXIST') res.status(409).json({ error: 'Already exists' });
    else if (code === 'EACCES' || code === 'EPERM') res.status(403).json({ error: 'Permission denied on the server' });
    else {
      log.error('Files API error', { error: String(err) });
      if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
}
