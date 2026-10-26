/**
 * Central OS state (zustand). UI components subscribe with selectors; OS
 * services (link, input, session) read and write it outside React too.
 */
import { create } from 'zustand';
import type { PairCode, PairRequest, RemoteInfo, TvSettings } from '@tvwebos/shared';
import { local } from '../../common/storage';
import { uid } from '../../common/format';
import type {
  Bounds,
  InstalledMiniApp,
  OsNotification,
  OsSettings,
  Overlay,
  Snap,
  TvAppShortcut,
  WindowInstance,
} from './types';

const SETTINGS_KEY = 'tvwebos.settings';

export const DEFAULT_SETTINGS: OsSettings = {
  theme: 'dark',
  accent: '#4f8cff',
  wallpaper: 'aurora',
  motion: 'auto',
  scale: 1,
  safeArea: 0,
  restoreSession: true,
  clock24h: true,
  showSeconds: false,
  remoteAutoKeyboard: true,
  deviceName: 'TV WebOS',
};

export type LinkStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'no-server' | 'replaced';

export interface LinkState {
  status: LinkStatus;
  retryInMs: number;
  latencyMs: number | null;
  serverBase: string | null;
  deviceId: string | null;
  tvName: string;
  apiToken: string | null;
  remotes: RemoteInfo[];
  pairCode: PairCode | null;
  pairRequests: PairRequest[];
  serverSettings: TvSettings | null;
}

export interface OsState {
  windows: WindowInstance[];
  focusedId: string | null;
  zTop: number;
  overlay: Overlay;
  notifications: OsNotification[];
  toasts: string[];
  dnd: boolean;
  settings: OsSettings;
  link: LinkState;
  miniapps: InstalledMiniApp[];
  tvApps: TvAppShortcut[];
  /** Apps pinned to the taskbar, in order. */
  pinned: string[];
  /** Cursor visibility (hidden after inactivity or when the Magic Remote takes over). */
  cursorVisible: boolean;

  // ---- windows ----
  openWindow: (appId: string, opts: { title: string; args?: Record<string, unknown>; bounds?: Bounds; maximized?: boolean }) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string | null) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  snapWindow: (id: string, snap: Snap) => void;
  setBounds: (id: string, bounds: Bounds) => void;
  setWindowTitle: (id: string, title: string) => void;
  setWindowArgs: (id: string, args: Record<string, unknown>) => void;
  minimizeAll: () => void;
  replaceWindows: (wins: WindowInstance[], focusedId: string | null) => void;

  // ---- shell ----
  setOverlay: (o: Overlay) => void;
  toggleOverlay: (o: Overlay) => void;
  notify: (n: Omit<OsNotification, 'id' | 'time' | 'read'>) => string;
  dismissToast: (id: string) => void;
  removeNotification: (id: string) => void;
  clearNotifications: () => void;
  markAllRead: () => void;
  setDnd: (v: boolean) => void;
  updateSettings: (patch: Partial<OsSettings>) => void;
  setLink: (patch: Partial<LinkState>) => void;
  setMiniapps: (apps: InstalledMiniApp[]) => void;
  setTvApps: (apps: TvAppShortcut[]) => void;
  setPinned: (ids: string[]) => void;
  setCursorVisible: (v: boolean) => void;
}

const DEFAULT_BOUNDS: Bounds = { x: 0.12, y: 0.08, w: 0.62, h: 0.72 };

function cascade(existing: WindowInstance[], base: Bounds): Bounds {
  const offset = (existing.filter((w) => w.mode !== 'minimized').length % 6) * 0.03;
  return {
    w: base.w,
    h: base.h,
    x: Math.min(base.x + offset, 1 - base.w),
    y: Math.min(base.y + offset, 1 - base.h),
  };
}

export const useOs = create<OsState>((set, get) => ({
  windows: [],
  focusedId: null,
  zTop: 1,
  overlay: 'none',
  notifications: [],
  toasts: [],
  dnd: false,
  settings: { ...DEFAULT_SETTINGS, ...local.getJson<Partial<OsSettings>>(SETTINGS_KEY, {}) },
  link: {
    status: 'idle',
    retryInMs: 0,
    latencyMs: null,
    serverBase: null,
    deviceId: null,
    tvName: '',
    apiToken: null,
    remotes: [],
    pairCode: null,
    pairRequests: [],
    serverSettings: null,
  },
  miniapps: [],
  tvApps: [],
  pinned: local.getJson<string[]>('tvwebos.pinned', ['files', 'media', 'youtube', 'gallery', 'browser', 'store', 'settings']),
  cursorVisible: false,

  openWindow: (appId, opts) => {
    const id = uid();
    set((s) => {
      const z = s.zTop + 1;
      const win: WindowInstance = {
        id,
        appId,
        title: opts.title,
        args: opts.args ?? {},
        bounds: cascade(s.windows, opts.bounds ?? DEFAULT_BOUNDS),
        mode: opts.maximized ? 'maximized' : 'normal',
        restoreMode: opts.maximized ? 'maximized' : 'normal',
        snap: null,
        z,
      };
      return { windows: [...s.windows, win], focusedId: id, zTop: z, overlay: 'none' };
    });
    return id;
  },

  closeWindow: (id) =>
    set((s) => {
      const windows = s.windows.filter((w) => w.id !== id);
      let focusedId = s.focusedId;
      if (focusedId === id) {
        const next = windows.filter((w) => w.mode !== 'minimized').sort((a, b) => b.z - a.z)[0];
        focusedId = next ? next.id : null;
      }
      return { windows, focusedId };
    }),

  focusWindow: (id) =>
    set((s) => {
      if (id === null) return { focusedId: null };
      const z = s.zTop + 1;
      return {
        zTop: z,
        focusedId: id,
        windows: s.windows.map((w) => (w.id === id ? { ...w, z, mode: w.mode === 'minimized' ? w.restoreMode : w.mode } : w)),
      };
    }),

  minimizeWindow: (id) =>
    set((s) => {
      const windows = s.windows.map((w) =>
        w.id === id && w.mode !== 'minimized' ? { ...w, restoreMode: w.mode as 'normal' | 'maximized', mode: 'minimized' as const } : w,
      );
      let focusedId = s.focusedId;
      if (focusedId === id) {
        const next = windows.filter((w) => w.mode !== 'minimized').sort((a, b) => b.z - a.z)[0];
        focusedId = next ? next.id : null;
      }
      return { windows, focusedId };
    }),

  toggleMaximize: (id) =>
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, mode: w.mode === 'maximized' ? 'normal' : 'maximized', snap: null } : w,
      ),
    })),

  snapWindow: (id, snap) =>
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, snap, mode: 'normal' } : w)),
    })),

  setBounds: (id, bounds) =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, bounds, snap: null } : w)) })),

  setWindowTitle: (id, title) =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id && w.title !== title ? { ...w, title } : w)) })),

  setWindowArgs: (id, args) =>
    set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, args } : w)) })),

  minimizeAll: () =>
    set((s) => ({
      focusedId: null,
      windows: s.windows.map((w) =>
        w.mode === 'minimized' ? w : { ...w, restoreMode: w.mode as 'normal' | 'maximized', mode: 'minimized' as const },
      ),
    })),

  replaceWindows: (windows, focusedId) =>
    set({ windows, focusedId, zTop: windows.reduce((m, w) => Math.max(m, w.z), 1) }),

  setOverlay: (overlay) => set({ overlay }),
  toggleOverlay: (o) => set((s) => ({ overlay: s.overlay === o ? 'none' : o })),

  notify: (n) => {
    const id = uid();
    const full: OsNotification = { ...n, id, time: Date.now(), read: false };
    set((s) => ({
      notifications: [full, ...s.notifications].slice(0, 100),
      toasts: s.dnd && !n.sticky ? s.toasts : [...s.toasts, id].slice(-4),
    }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t !== id) })),
  removeNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id), toasts: s.toasts.filter((t) => t !== id) })),
  clearNotifications: () => set({ notifications: [], toasts: [] }),
  markAllRead: () => set((s) => ({ notifications: s.notifications.map((n) => (n.read ? n : { ...n, read: true })) })),
  setDnd: (dnd) => set({ dnd }),

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    local.setJson(SETTINGS_KEY, settings);
    set({ settings });
  },
  setLink: (patch) => set((s) => ({ link: { ...s.link, ...patch } })),
  setMiniapps: (miniapps) => set({ miniapps }),
  setTvApps: (tvApps) => set({ tvApps }),
  setPinned: (pinned) => {
    local.setJson('tvwebos.pinned', pinned);
    set({ pinned });
  },
  setCursorVisible: (cursorVisible) => set({ cursorVisible }),
}));

export const os = {
  get: () => useOs.getState(),
};
