/**
 * Mini-app lifecycle: catalog, install from catalog or URL, update, uninstall.
 * Installed apps are kept in IndexedDB; their storage lives in the "appdata"
 * store under "<appId>\u0000<key>".
 */
import { compareVersions, validateManifest, type MiniAppManifest } from '@tvwebos/shared/miniapp';
import { idb } from '../../common/idb';
import { api, absUrl } from './api';
import { os } from './store';
import type { InstalledMiniApp, TvAppShortcut } from './types';

const KEY = 'miniapps';
const TVAPPS_KEY = 'tvapps';

export interface CatalogApp {
  manifest: MiniAppManifest;
  manifestUrl: string;
}

export async function loadInstalled(): Promise<void> {
  try {
    const apps = (await idb.get<InstalledMiniApp[]>('kv', KEY)) ?? [];
    os.get().setMiniapps(apps);
    const tv = (await idb.get<TvAppShortcut[]>('kv', TVAPPS_KEY)) ?? [];
    os.get().setTvApps(tv);
  } catch (err) {
    os.get().notify({
      title: 'Không đọc được bộ nhớ TV',
      body: 'IndexedDB không khả dụng; ứng dụng đã cài sẽ không được lưu.',
      level: 'warning',
    });
    console.warn(err);
  }
}

async function persist(apps: InstalledMiniApp[]): Promise<void> {
  os.get().setMiniapps(apps);
  await idb.put('kv', apps, KEY);
}

export async function fetchCatalog(): Promise<CatalogApp[]> {
  const res = await api<{ apps: CatalogApp[] }>('/api/catalog');
  return res.apps;
}

function resolveAgainst(base: string, rel?: string): string | undefined {
  if (!rel) return undefined;
  return new URL(rel, base).href;
}

/** Fetch + validate a manifest from an absolute URL. */
export async function fetchManifest(url: string): Promise<{ manifest: MiniAppManifest; url: string }> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch {
    throw new Error('Không tải được manifest (lỗi mạng hoặc máy chủ không cho phép CORS)');
  }
  if (!res.ok) throw new Error(`Không tải được manifest (HTTP ${res.status})`);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error('Manifest không phải JSON hợp lệ');
  }
  const result = validateManifest(json);
  if (!result.ok) throw new Error(`Manifest không hợp lệ: ${result.error}`);
  return { manifest: result.manifest, url: res.url || url };
}

export async function install(manifestUrl: string, source: InstalledMiniApp['source']): Promise<InstalledMiniApp> {
  const abs = /^https?:\/\//i.test(manifestUrl) ? manifestUrl : absUrl(manifestUrl);
  const { manifest, url } = await fetchManifest(abs);
  const entryUrl = resolveAgainst(url, manifest.entry)!;
  if (!/^https?:\/\//i.test(entryUrl)) throw new Error('entry phải là địa chỉ http(s)');
  const now = Date.now();
  const existing = os.get().miniapps.find((a) => a.manifest.id === manifest.id);
  const app: InstalledMiniApp = {
    manifest,
    manifestUrl: abs,
    baseUrl: url,
    entryUrl,
    iconUrl: resolveAgainst(url, manifest.icon),
    source,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  };
  await persist([...os.get().miniapps.filter((a) => a.manifest.id !== manifest.id), app]);
  return app;
}

export async function uninstall(appId: string): Promise<void> {
  const s = os.get();
  for (const w of s.windows) if (w.appId === `miniapp:${appId}`) s.closeWindow(w.id);
  await persist(s.miniapps.filter((a) => a.manifest.id !== appId));
  // Remove the app's stored data.
  const prefix = `${appId}\u0000`;
  try {
    await idb.delete('appdata', IDBKeyRange.bound(prefix, `${prefix}￿`));
  } catch {
    // ignore
  }
  const pinned = s.pinned.filter((p) => p !== `miniapp:${appId}`);
  if (pinned.length !== s.pinned.length) s.setPinned(pinned);
}

/** Check installed apps against their manifest URLs. Returns ids with a newer version. */
export async function checkUpdates(): Promise<Map<string, MiniAppManifest>> {
  const out = new Map<string, MiniAppManifest>();
  await Promise.all(
    os.get().miniapps.map(async (app) => {
      try {
        const { manifest } = await fetchManifest(app.manifestUrl);
        if (manifest.id === app.manifest.id && compareVersions(manifest.version, app.manifest.version) > 0) {
          out.set(app.manifest.id, manifest);
        }
      } catch {
        // unreachable source: no update info
      }
    }),
  );
  return out;
}

export async function saveTvApps(apps: TvAppShortcut[]): Promise<void> {
  os.get().setTvApps(apps);
  await idb.put('kv', apps, TVAPPS_KEY);
}

// ---- Mini-app storage (used by the SDK host) ---------------------------------

const MAX_VALUE_BYTES = 256 * 1024;

export async function appStorageGet(appId: string, key: string): Promise<unknown> {
  return idb.get('appdata', `${appId}\u0000${key}`);
}

export async function appStorageSet(appId: string, key: string, value: unknown): Promise<void> {
  const size = JSON.stringify(value ?? null).length;
  if (size > MAX_VALUE_BYTES) throw new Error(`Value too large (${size} bytes, max ${MAX_VALUE_BYTES})`);
  await idb.put('appdata', value, `${appId}\u0000${key}`);
}

export async function appStorageRemove(appId: string, key: string): Promise<void> {
  await idb.delete('appdata', `${appId}\u0000${key}`);
}

export async function appStorageKeys(appId: string): Promise<string[]> {
  const prefix = `${appId}\u0000`;
  const keys = await idb.getAllKeys('appdata', IDBKeyRange.bound(prefix, `${prefix}￿`));
  return keys.map((k) => String(k).slice(prefix.length));
}
