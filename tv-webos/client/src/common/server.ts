/**
 * Where is the TV WebOS server?
 *
 * 1. `?server=http://host:port` in the page URL (persisted for next time)
 * 2. A previously saved address (Settings > Network)
 * 3. VITE_SERVER_URL baked in at build time (used for the packaged webOS app)
 * 4. The page's own origin when served over http(s)
 *
 * Returns null when none applies (packaged app without configuration).
 */
import { WS_PATH } from '@tvwebos/shared/constants';
import { local } from './storage';

const KEY = 'tvwebos.server';

export function normalizeServerUrl(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'http://' + v;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export function getServerBase(): string | null {
  const fromQuery = new URLSearchParams(location.search).get('server');
  if (fromQuery) {
    const n = normalizeServerUrl(fromQuery);
    if (n) {
      local.set(KEY, n);
      return n;
    }
  }
  const saved = local.get(KEY);
  if (saved) return saved;
  const baked = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (baked) return normalizeServerUrl(baked);
  if (location.protocol === 'http:' || location.protocol === 'https:') return location.origin;
  return null;
}

export function setServerBase(url: string | null): void {
  if (url) local.set(KEY, url);
  else local.remove(KEY);
}

export function wsUrl(base: string): string {
  return base.replace(/^http/i, 'ws') + WS_PATH;
}

/** Resolve a server-relative URL ("/api/...") against the server base. */
export function serverUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return base + (path.startsWith('/') ? path : '/' + path);
}
