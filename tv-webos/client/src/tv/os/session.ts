/**
 * Session persistence: open windows (app, geometry, arguments) are saved to
 * IndexedDB and restored on the next start when "restore session" is on.
 */
import { idb } from '../../common/idb';
import { appDescriptor } from './apps';
import { os, useOs } from './store';
import type { WindowInstance } from './types';

const KEY = 'session';

interface SavedSession {
  version: 1;
  windows: WindowInstance[];
  focusedId: string | null;
}

function serializableArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k.startsWith('_')) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
  }
  return out;
}

export async function restoreSession(): Promise<number> {
  if (!os.get().settings.restoreSession) return 0;
  let saved: SavedSession | undefined;
  try {
    saved = await idb.get<SavedSession>('kv', KEY);
  } catch {
    return 0;
  }
  if (!saved || saved.version !== 1 || !Array.isArray(saved.windows)) return 0;
  // Drop windows of apps that were uninstalled meanwhile.
  const windows = saved.windows.filter((w) => appDescriptor(w.appId));
  const focusedId = windows.some((w) => w.id === saved!.focusedId) ? saved.focusedId : null;
  os.get().replaceWindows(windows, focusedId);
  return windows.length;
}

let timer: number | null = null;

export function startSessionSaver(): void {
  useOs.subscribe((s, prev) => {
    if (s.windows === prev.windows && s.focusedId === prev.focusedId) return;
    if (timer !== null) clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      const st = os.get();
      const data: SavedSession = {
        version: 1,
        windows: st.windows.map((w) => ({ ...w, args: serializableArgs(w.args) })),
        focusedId: st.focusedId,
      };
      idb.put('kv', data, KEY).catch(() => undefined);
    }, 600);
  });
}
