/**
 * LG webOS platform integration.
 *
 * What a web page can do depends on how it is running, and this module
 * detects it at runtime instead of assuming:
 *
 *  - "launcher": the desktop is embedded by the packaged TV WebOS app
 *    (webos/launcher). The launcher runs as a real webOS app, loads LG's
 *    webOSTV.js and answers a small allow-listed set of requests over
 *    postMessage (device info, launching TV apps, exiting).
 *  - "webos-app": webOSTV.js is available in this very page (the desktop was
 *    packaged directly). Same capabilities, called directly.
 *  - "webos-browser": the LG web browser. No Luna service access: the page
 *    cannot launch other apps, change volume or input, or read system info.
 *  - "browser": any other browser.
 *
 * Only APIs documented for webOS TV apps are used: webOS.deviceInfo,
 * webOS.platformBack and the com.webos.applicationManager "launch" method.
 * Each call reports failure (e.g. missing permission) instead of throwing.
 */

export type PlatformMode = 'launcher' | 'webos-app' | 'webos-browser' | 'browser';

export interface Capabilities {
  mode: PlatformMode;
  /** User agent says LG webOS TV. */
  isWebOsTv: boolean;
  deviceInfo: boolean;
  launchApps: boolean;
  exitApp: boolean;
}

export interface DeviceInfo {
  [key: string]: unknown;
}

interface WebOsGlobal {
  deviceInfo?: (cb: (info: DeviceInfo) => void) => void;
  platformBack?: () => void;
  fetchAppId?: () => string;
  service?: {
    request: (
      uri: string,
      opts: {
        method: string;
        parameters?: Record<string, unknown>;
        onSuccess?: (res: Record<string, unknown>) => void;
        onFailure?: (res: { errorCode?: number | string; errorText?: string }) => void;
      },
    ) => unknown;
  };
}

declare global {
  interface Window {
    webOS?: WebOsGlobal;
    PalmSystem?: unknown;
  }
}

const BRIDGE_TAG = 'tvwebos-bridge';
let mode: PlatformMode = 'browser';
let pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();
let nextId = 1;

export function isWebOsUserAgent(): boolean {
  return /Web0S|webOS/i.test(navigator.userAgent);
}

function bridgeCall<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = nextId++;
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error('The webOS launcher did not answer'));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    window.parent.postMessage({ tag: BRIDGE_TAG, id, method, params }, '*');
  });
}

function onBridgeMessage(e: MessageEvent): void {
  if (e.source !== window.parent) return;
  const d = e.data as { tag?: string; id?: number; ok?: boolean; result?: unknown; error?: string } | null;
  if (!d || d.tag !== BRIDGE_TAG || typeof d.id !== 'number') return;
  const p = pending.get(d.id);
  if (!p) return;
  pending.delete(d.id);
  clearTimeout(p.timer);
  if (d.ok) p.resolve(d.result);
  else p.reject(new Error(d.error || 'webOS request failed'));
}

/** Detect the platform. Resolves quickly in every case. */
export async function detectPlatform(): Promise<Capabilities> {
  if (window.parent !== window) {
    window.addEventListener('message', onBridgeMessage);
    try {
      await bridgeCall('hello', {}, 800);
      mode = 'launcher';
    } catch {
      window.removeEventListener('message', onBridgeMessage);
      pending = new Map();
    }
  }
  if (mode !== 'launcher') {
    if (window.webOS && (window.webOS.service || window.webOS.deviceInfo)) mode = 'webos-app';
    else if (isWebOsUserAgent()) mode = 'webos-browser';
    else mode = 'browser';
  }
  const app = mode === 'launcher' || mode === 'webos-app';
  return {
    mode,
    isWebOsTv: isWebOsUserAgent(),
    deviceInfo: app,
    launchApps: app,
    exitApp: app,
  };
}

export function getDeviceInfo(): Promise<DeviceInfo> {
  if (mode === 'launcher') return bridgeCall<DeviceInfo>('deviceInfo');
  if (mode === 'webos-app' && window.webOS?.deviceInfo) {
    return new Promise((resolve) => window.webOS!.deviceInfo!((info) => resolve(info)));
  }
  return Promise.reject(new Error('Device information is only available inside the packaged webOS app'));
}

/** Launch an app installed on the TV by its webOS app id. */
export function launchTvApp(appId: string, params: Record<string, string> = {}): Promise<void> {
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(appId)) return Promise.reject(new Error('Invalid app id'));
  if (mode === 'launcher') return bridgeCall<void>('launch', { id: appId, params });
  if (mode === 'webos-app' && window.webOS?.service) {
    return new Promise((resolve, reject) => {
      window.webOS!.service!.request('luna://com.webos.applicationManager', {
        method: 'launch',
        parameters: { id: appId, params },
        onSuccess: () => resolve(),
        onFailure: (err) => reject(new Error(err.errorText || `Launch failed (${err.errorCode ?? 'unknown'})`)),
      });
    });
  }
  return Promise.reject(
    new Error('Launching TV apps needs the packaged TV WebOS app. The webOS browser does not allow it.'),
  );
}

/** Leave the app (back to the previous TV screen). */
export function exitApp(): Promise<void> {
  if (mode === 'launcher') return bridgeCall<void>('exit');
  if (mode === 'webos-app' && window.webOS?.platformBack) {
    window.webOS.platformBack();
    return Promise.resolve();
  }
  return Promise.reject(new Error('Not running as a webOS app'));
}

export function platformMode(): PlatformMode {
  return mode;
}

export function describeMode(m: PlatformMode): string {
  switch (m) {
    case 'launcher':
      return 'Ứng dụng webOS đã cài (launcher) - có quyền gọi API webOS được cho phép';
    case 'webos-app':
      return 'Ứng dụng webOS (webOSTV.js) - có quyền gọi API webOS được cho phép';
    case 'webos-browser':
      return 'Trình duyệt web của LG webOS - không có quyền gọi API hệ thống';
    default:
      return 'Trình duyệt thông thường - không có tích hợp webOS';
  }
}
