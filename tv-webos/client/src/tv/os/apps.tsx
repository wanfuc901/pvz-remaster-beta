/**
 * App registry: built-in apps, installed mini-apps and TV app shortcuts
 * behind one descriptor type, plus `launch()`.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { AppWindow, Film, Folder, Globe, Image, LayoutGrid, Settings, Store, FileText, Tv } from 'lucide-react';
import { launchTvApp } from '../platform/webos';
import { os, useOs } from './store';
import type { AppDescriptor, WindowProps } from './types';

type AppComponent = LazyExoticComponent<ComponentType<WindowProps>>;

interface BuiltinApp extends AppDescriptor {
  component: AppComponent;
}

const glyph = (C: typeof Folder) => <C strokeWidth={1.8} />;

export const BUILTIN_APPS: BuiltinApp[] = [
  {
    id: 'files',
    name: 'Tệp',
    kind: 'builtin',
    color: '#3b82f6',
    glyph: glyph(Folder),
    description: 'Duyệt thư viện media trên server và bộ nhớ của TV',
    singleton: false,
    component: lazy(() => import('../apps/files/FilesApp')),
  },
  {
    id: 'media',
    name: 'Trình phát',
    kind: 'builtin',
    color: '#ef4444',
    glyph: glyph(Film),
    description: 'Phát video và nhạc',
    singleton: true,
    startMaximized: true,
    component: lazy(() => import('../apps/media/MediaApp')),
  },
  {
    id: 'gallery',
    name: 'Thư viện ảnh',
    kind: 'builtin',
    color: '#f59e0b',
    glyph: glyph(Image),
    description: 'Xem ảnh và trình chiếu',
    singleton: true,
    startMaximized: true,
    component: lazy(() => import('../apps/gallery/GalleryApp')),
  },
  {
    id: 'browser',
    name: 'Trình duyệt',
    kind: 'builtin',
    color: '#10b981',
    glyph: glyph(Globe),
    description: 'Mở trang web cho phép nhúng',
    singleton: false,
    component: lazy(() => import('../apps/browser/BrowserApp')),
  },
  {
    id: 'store',
    name: 'App Store',
    kind: 'builtin',
    color: '#8b5cf6',
    glyph: glyph(Store),
    description: 'Cài đặt, cập nhật và gỡ mini-app',
    singleton: true,
    component: lazy(() => import('../apps/store/StoreApp')),
  },
  {
    id: 'tvapps',
    name: 'Ứng dụng TV',
    kind: 'builtin',
    color: '#0ea5e9',
    glyph: glyph(Tv),
    description: 'Lối tắt tới ứng dụng webOS đã cài trên TV',
    singleton: true,
    component: lazy(() => import('../apps/tvapps/TvAppsApp')),
  },
  {
    id: 'settings',
    name: 'Cài đặt',
    kind: 'builtin',
    color: '#64748b',
    glyph: glyph(Settings),
    description: 'Giao diện, thiết bị ghép nối, hệ thống',
    singleton: true,
    component: lazy(() => import('../apps/settings/SettingsApp')),
  },
  {
    id: 'viewer',
    name: 'Xem văn bản',
    kind: 'builtin',
    color: '#475569',
    glyph: glyph(FileText),
    singleton: false,
    hidden: true,
    component: lazy(() => import('../apps/viewer/TextViewerApp')),
  },
];

const MiniAppFrame = lazy(() => import('../apps/miniapp/MiniAppFrame'));

export function builtinComponent(appId: string): AppComponent | null {
  if (appId.startsWith('miniapp:')) return MiniAppFrame;
  return BUILTIN_APPS.find((a) => a.id === appId)?.component ?? null;
}

/** Every launchable app, as shown in the launcher. */
export function allApps(state = os.get()): AppDescriptor[] {
  const mini: AppDescriptor[] = state.miniapps.map((m) => ({
    id: `miniapp:${m.manifest.id}`,
    name: m.manifest.name,
    kind: 'miniapp',
    color: m.manifest.color ?? '#334155',
    iconUrl: m.iconUrl,
    description: m.manifest.description,
    singleton: true,
    wantsGamepad: m.manifest.permissions.includes('gamepad'),
  }));
  const tv: AppDescriptor[] = state.tvApps.map((t) => ({
    id: `tvapp:${t.id}`,
    name: t.name,
    kind: 'tvapp',
    color: t.color,
    glyph: glyph(Tv),
    description: `Ứng dụng TV: ${t.webosAppId}`,
    singleton: true,
  }));
  return [...BUILTIN_APPS.filter((a) => !a.hidden), ...mini, ...tv];
}

export function appDescriptor(appId: string, state = os.get()): AppDescriptor | null {
  const builtin = BUILTIN_APPS.find((a) => a.id === appId);
  if (builtin) return builtin;
  return allApps(state).find((a) => a.id === appId) ?? null;
}

export function useAllApps(): AppDescriptor[] {
  // Re-render when installed apps change.
  useOs((s) => s.miniapps);
  useOs((s) => s.tvApps);
  return allApps();
}

export const FallbackGlyph = () => <AppWindow strokeWidth={1.8} />;
export const LauncherGlyph = () => <LayoutGrid strokeWidth={1.8} />;

/**
 * Open an app. Singletons are focused (and get the new args) instead of
 * opening a second window. TV app shortcuts are launched through webOS.
 */
export function launch(appId: string, args: Record<string, unknown> = {}): string | null {
  const state = os.get();
  const app = appDescriptor(appId, state);
  if (!app) {
    state.notify({ title: 'Không tìm thấy ứng dụng', body: appId, level: 'error' });
    return null;
  }
  if (app.kind === 'tvapp') {
    const shortcut = state.tvApps.find((t) => `tvapp:${t.id}` === appId);
    if (shortcut) {
      launchTvApp(shortcut.webosAppId, shortcut.params).then(
        () => state.setOverlay('none'),
        (err: Error) => state.notify({ title: `Không mở được ${shortcut.name}`, body: err.message, level: 'error' }),
      );
    }
    return null;
  }
  if (app.singleton) {
    const existing = state.windows.find((w) => w.appId === appId);
    if (existing) {
      if (Object.keys(args).length) state.setWindowArgs(existing.id, { ...args, _nonce: Date.now() });
      state.focusWindow(existing.id);
      state.setOverlay('none');
      return existing.id;
    }
  }
  return state.openWindow(appId, {
    title: app.name,
    args,
    bounds: app.defaultBounds,
    maximized: app.startMaximized,
  });
}
