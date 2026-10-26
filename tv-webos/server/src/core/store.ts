/**
 * Persistent device store (TVs and their paired remotes).
 *
 * Data is small and write-light, so it lives in a single JSON file written
 * atomically (temp file + rename). Secrets are stored only as SHA-256 hashes;
 * they are high-entropy random tokens, so a slow KDF is not needed.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RemoteInfo, TvSettings } from '@tvwebos/shared';
import { randomBytes } from 'node:crypto';
import { log } from './log.js';
import { randomId, randomToken, safeEqual, sha256 } from './crypto.js';

export interface RemoteRecord {
  id: string;
  name: string;
  platform: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface TvRecord {
  id: string;
  secretHash: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  settings: TvSettings;
  remotes: Record<string, RemoteRecord>;
}

interface StoreFile {
  version: 1;
  tvs: Record<string, TvRecord>;
}

export const DEFAULT_TV_SETTINGS: TvSettings = { requireConfirm: true, maxRemotes: 4 };

const TV_RETENTION_MS = 180 * 24 * 3600 * 1000;

export class DeviceStore {
  private data: StoreFile = { version: 1, tvs: {} };
  private readonly file: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly remoteIdleMs: number;

  constructor(
    private readonly dataDir: string,
    remoteIdleDays: number,
    private readonly now: () => number = Date.now,
  ) {
    this.file = path.join(dataDir, 'devices.json');
    this.remoteIdleMs = remoteIdleDays * 24 * 3600 * 1000;
  }

  load(): void {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as StoreFile;
      if (parsed && parsed.version === 1 && parsed.tvs && typeof parsed.tvs === 'object') {
        this.data = parsed;
        for (const tv of Object.values(this.data.tvs)) {
          tv.settings = { ...DEFAULT_TV_SETTINGS, ...tv.settings };
        }
      } else {
        throw new Error('unsupported format');
      }
    } catch (err) {
      const backup = `${this.file}.corrupt-${this.now()}`;
      fs.renameSync(this.file, backup);
      log.error('Device store unreadable, starting empty', { backup, error: String(err) });
    }
    this.prune();
  }

  /** Server-wide HMAC secret, created on first start. */
  loadServerSecret(): Buffer {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const file = path.join(this.dataDir, 'server.key');
    if (fs.existsSync(file)) {
      const buf = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
      if (buf.length >= 32) return buf;
    }
    const secret = randomBytes(32);
    fs.writeFileSync(file, secret.toString('hex'), { mode: 0o600 });
    return secret;
  }

  // ---- TVs -------------------------------------------------------------

  createTv(name: string): { tv: TvRecord; secret: string } {
    const secret = randomToken(32);
    const t = this.now();
    const tv: TvRecord = {
      id: randomId(),
      secretHash: sha256(secret),
      name,
      createdAt: t,
      lastSeenAt: t,
      settings: { ...DEFAULT_TV_SETTINGS },
      remotes: {},
    };
    this.data.tvs[tv.id] = tv;
    this.scheduleSave();
    return { tv, secret };
  }

  /** Returns the TV if `secret` matches, otherwise null. */
  authenticateTv(id: string, secret: string): TvRecord | null {
    const tv = this.data.tvs[id];
    if (!tv) return null;
    if (!safeEqual(tv.secretHash, sha256(secret))) return null;
    tv.lastSeenAt = this.now();
    this.scheduleSave();
    return tv;
  }

  getTv(id: string): TvRecord | null {
    return this.data.tvs[id] ?? null;
  }

  updateTv(id: string, patch: { name?: string; settings?: Partial<TvSettings> }): TvRecord | null {
    const tv = this.data.tvs[id];
    if (!tv) return null;
    if (patch.name !== undefined) tv.name = patch.name;
    if (patch.settings) tv.settings = { ...tv.settings, ...patch.settings };
    this.scheduleSave();
    return tv;
  }

  // ---- Remotes ---------------------------------------------------------

  addRemote(tvId: string, name: string, platform: string): { remote: RemoteRecord; token: string } | null {
    const tv = this.data.tvs[tvId];
    if (!tv) return null;
    const token = randomToken(32);
    const t = this.now();
    const remote: RemoteRecord = { id: randomId(), name, platform, tokenHash: sha256(token), createdAt: t, lastSeenAt: t };
    tv.remotes[remote.id] = remote;
    this.scheduleSave();
    return { remote, token };
  }

  /** Finds the remote by id across TVs and checks its token and idle expiry. */
  authenticateRemote(remoteId: string, token: string): { tv: TvRecord; remote: RemoteRecord } | null {
    for (const tv of Object.values(this.data.tvs)) {
      const remote = tv.remotes[remoteId];
      if (!remote) continue;
      if (!safeEqual(remote.tokenHash, sha256(token))) return null;
      if (this.now() - remote.lastSeenAt > this.remoteIdleMs) {
        delete tv.remotes[remoteId];
        this.scheduleSave();
        return null;
      }
      remote.lastSeenAt = this.now();
      this.scheduleSave();
      return { tv, remote };
    }
    return null;
  }

  findRemote(tvId: string, remoteId: string): RemoteRecord | null {
    return this.data.tvs[tvId]?.remotes[remoteId] ?? null;
  }

  touchRemote(tvId: string, remoteId: string): void {
    const remote = this.findRemote(tvId, remoteId);
    if (remote) {
      remote.lastSeenAt = this.now();
      this.scheduleSave();
    }
  }

  removeRemote(tvId: string, remoteId: string): boolean {
    const tv = this.data.tvs[tvId];
    if (!tv || !tv.remotes[remoteId]) return false;
    delete tv.remotes[remoteId];
    this.scheduleSave();
    return true;
  }

  remoteCount(tvId: string): number {
    const tv = this.data.tvs[tvId];
    return tv ? Object.keys(tv.remotes).length : 0;
  }

  listRemotes(tvId: string, isOnline: (remoteId: string) => boolean): RemoteInfo[] {
    const tv = this.data.tvs[tvId];
    if (!tv) return [];
    return Object.values(tv.remotes)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((r) => ({
        id: r.id,
        name: r.name,
        platform: r.platform,
        createdAt: r.createdAt,
        lastSeenAt: r.lastSeenAt,
        online: isOnline(r.id),
      }));
  }

  // ---- Persistence -----------------------------------------------------

  /** Remove idle remotes and long-unused TVs. */
  prune(): void {
    const t = this.now();
    let changed = false;
    for (const [tvId, tv] of Object.entries(this.data.tvs)) {
      if (t - tv.lastSeenAt > TV_RETENTION_MS) {
        delete this.data.tvs[tvId];
        changed = true;
        continue;
      }
      for (const [rid, r] of Object.entries(tv.remotes)) {
        if (t - r.lastSeenAt > this.remoteIdleMs) {
          delete tv.remotes[rid];
          changed = true;
        }
      }
    }
    if (changed) this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 500);
    this.saveTimer.unref?.();
  }

  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (err) {
      log.error('Failed to save device store', { error: String(err) });
    }
  }
}
