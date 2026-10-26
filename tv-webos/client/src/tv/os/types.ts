import type { ReactNode } from 'react';
import type { MiniAppManifest } from '@tvwebos/shared/miniapp';

/** Window geometry as fractions (0..1) of the desktop work area, so it survives resolution changes. */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type WindowMode = 'normal' | 'minimized' | 'maximized';
export type Snap = 'left' | 'right' | null;

export interface WindowInstance {
  id: string;
  appId: string;
  title: string;
  args: Record<string, unknown>;
  bounds: Bounds;
  mode: WindowMode;
  /** Mode to return to when un-minimising. */
  restoreMode: 'normal' | 'maximized';
  snap: Snap;
  z: number;
}

export interface WindowProps {
  win: WindowInstance;
}

export type AppKind = 'builtin' | 'miniapp' | 'tvapp';

export interface AppDescriptor {
  id: string;
  name: string;
  kind: AppKind;
  /** Tile colour. */
  color: string;
  /** Glyph for built-ins; mini-apps use iconUrl. */
  glyph?: ReactNode;
  iconUrl?: string;
  description?: string;
  /** Only one window of this app. */
  singleton: boolean;
  defaultBounds?: Bounds;
  startMaximized?: boolean;
  /** Receives raw gamepad state instead of D-pad emulation. */
  wantsGamepad?: boolean;
  /** Hidden from launcher (e.g. viewers opened from Files). */
  hidden?: boolean;
}

export interface InstalledMiniApp {
  manifest: MiniAppManifest;
  manifestUrl: string;
  /** Absolute URL the entry/icon are resolved against. */
  baseUrl: string;
  entryUrl: string;
  iconUrl?: string;
  source: 'catalog' | 'url';
  installedAt: number;
  updatedAt: number;
}

/** Shortcut to an app installed on the TV itself (launched through the webOS API). */
export interface TvAppShortcut {
  id: string;
  name: string;
  webosAppId: string;
  params?: Record<string, string>;
  color: string;
}

export interface NotificationAction {
  label: string;
  run: () => void;
}

export interface OsNotification {
  id: string;
  title: string;
  body?: string;
  appId?: string;
  level: 'info' | 'success' | 'warning' | 'error';
  time: number;
  read: boolean;
  actions?: NotificationAction[];
  /** Keep the toast until dismissed. */
  sticky?: boolean;
}

export type Overlay = 'none' | 'launcher' | 'switcher' | 'notifications' | 'pairing';

export interface OsSettings {
  theme: 'dark' | 'light';
  accent: string;
  wallpaper: string;
  /** full: all animations; reduced: short fades only; off: no animation, no blur, flat shadows. */
  motion: 'auto' | 'full' | 'reduced' | 'off';
  /** UI scale multiplier on top of the viewport-based base size. */
  scale: number;
  /** Overscan safe area, % of each edge. */
  safeArea: number;
  restoreSession: boolean;
  clock24h: boolean;
  showSeconds: boolean;
  /** Open the keyboard panel on phones automatically when a text field is focused. */
  remoteAutoKeyboard: boolean;
  deviceName: string;
}
