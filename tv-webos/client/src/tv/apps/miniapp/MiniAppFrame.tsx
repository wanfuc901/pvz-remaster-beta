/**
 * Hosts an installed mini-app in a sandboxed iframe and implements the host
 * side of the TV WebOS SDK (public/sdk/tvwebos-sdk.js).
 *
 * The frame runs with `sandbox="allow-scripts allow-forms"` and no
 * `allow-same-origin`, so it gets an opaque origin: it cannot read the
 * desktop's storage or credentials even when served from the same server.
 * Everything it can do goes through the permission-checked messages below.
 */
import { useEffect, useRef, useState } from 'react';
import { MINIAPP_API_VERSION, type MiniAppPermission } from '@tvwebos/shared/miniapp';
import type { NavKey } from '@tvwebos/shared/constants';
import { addBackHandler, registerFrame } from '../../os/bus';
import { goBack } from '../../os/shell';
import { navigate } from '../../os/spatialNav';
import { syntheticKey } from '../../os/keys';
import { os, useOs } from '../../os/store';
import { setFrameText } from '../../os/textBridge';
import { appStorageGet, appStorageKeys, appStorageRemove, appStorageSet } from '../../os/miniapps';
import type { WindowProps } from '../../os/types';

interface Request {
  tvwebos: 1;
  type: 'request';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

const PERMISSION_OF: Record<string, MiniAppPermission | null> = {
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.remove': 'storage',
  'storage.keys': 'storage',
  notify: 'notifications',
  'text.focus': null,
  'text.blur': null,
  setTitle: null,
  close: null,
  'system.back': null,
  'system.key': null,
};

const ARROW_DIR: Partial<Record<NavKey, 'up' | 'down' | 'left' | 'right'>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

export default function MiniAppFrame({ win }: WindowProps) {
  const appId = win.appId.slice('miniapp:'.length);
  const app = useOs((s) => s.miniapps.find((m) => m.manifest.id === appId));
  const theme = useOs((s) => s.settings.theme);
  const accent = useOs((s) => s.settings.accent);
  const focused = useOs((s) => s.focusedId === win.id);
  const ref = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe || !app) return;
    const perms = new Set(app.manifest.permissions);
    const post = (msg: unknown) => {
      iframe.contentWindow?.postMessage({ tvwebos: 1, ...(msg as Record<string, unknown>) }, '*');
    };

    const unregister = registerFrame({ windowId: win.id, iframe, wantsGamepad: perms.has('gamepad'), post });
    const removeBack = addBackHandler(win.id, () => {
      if (!ready) return false;
      post({ type: 'back' });
      return true;
    });

    const respond = (id: number, ok: boolean, result?: unknown, error?: string) =>
      post({ type: 'response', id, ok, result, error });

    const onMessage = async (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow) return;
      const d = e.data as Partial<Omit<Request, 'type'>> & { type?: string };
      if (!d || d.tvwebos !== 1) return;
      if (d.type === 'ready') {
        setReady(true);
        post({
          type: 'init',
          appId,
          apiVersion: MINIAPP_API_VERSION,
          permissions: [...perms],
          theme: { mode: theme, accent },
        });
        return;
      }
      if (d.type !== 'request' || typeof d.id !== 'number' || typeof d.method !== 'string') return;
      const method = d.method;
      const params = (d.params ?? {}) as Record<string, unknown>;
      if (!(method in PERMISSION_OF)) return respond(d.id, false, undefined, `Unknown method ${method}`);
      const needed = PERMISSION_OF[method];
      if (needed && !perms.has(needed)) {
        return respond(d.id, false, undefined, `Permission "${needed}" is not declared in the manifest`);
      }
      try {
        const key = typeof params.key === 'string' ? params.key.slice(0, 200) : '';
        switch (method) {
          case 'storage.get':
            return respond(d.id, true, await appStorageGet(appId, key));
          case 'storage.set':
            await appStorageSet(appId, key, params.value);
            return respond(d.id, true);
          case 'storage.remove':
            await appStorageRemove(appId, key);
            return respond(d.id, true);
          case 'storage.keys':
            return respond(d.id, true, await appStorageKeys(appId));
          case 'notify':
            os.get().notify({
              title: String(params.title ?? app.manifest.name).slice(0, 120),
              body: typeof params.body === 'string' ? params.body.slice(0, 500) : undefined,
              appId: win.appId,
              level: 'info',
            });
            return respond(d.id, true);
          case 'setTitle':
            os.get().setWindowTitle(win.id, String(params.title ?? app.manifest.name).slice(0, 80));
            return respond(d.id, true);
          case 'close':
            os.get().closeWindow(win.id);
            return respond(d.id, true);
          case 'text.focus':
            setFrameText({
              focus: {
                value: String(params.value ?? '').slice(0, 10_000),
                inputType: String(params.inputType ?? 'text').slice(0, 32),
                placeholder: String(params.placeholder ?? '').slice(0, 256),
                multiline: params.multiline === true,
              },
              apply: (value) => post({ type: 'text', op: 'set', value }),
              submit: () => post({ type: 'text', op: 'submit' }),
            });
            return respond(d.id, true);
          case 'text.blur':
            setFrameText(null);
            return respond(d.id, true);
          case 'system.back':
            // The app did not handle Back itself.
            os.get().minimizeWindow(win.id);
            return respond(d.id, true);
          case 'system.key': {
            // A key the app did not handle: let the shell react (leave the frame, colour keys...).
            const k = String(params.key) as NavKey;
            const dir = ARROW_DIR[k];
            if (dir) navigate(dir);
            else if (k === 'Back' || k === 'Escape') goBack();
            else window.dispatchEvent(syntheticKey('keydown', k));
            return respond(d.id, true);
          }
        }
      } catch (err) {
        respond(d.id, false, undefined, err instanceof Error ? err.message : String(err));
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      unregister();
      removeBack();
      setFrameText(null);
    };
  }, [app, appId, win.id, ready, theme, accent]);

  useEffect(() => {
    if (ready) return;
    const t = window.setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    ref.current?.contentWindow?.postMessage({ tvwebos: 1, type: 'visibility', focused }, '*');
  }, [focused]);

  if (!app) {
    return (
      <div className="app-empty">
        <h2>Mini-app đã bị gỡ</h2>
        <p>Ứng dụng {appId} không còn được cài đặt.</p>
      </div>
    );
  }

  return (
    <div className="miniapp-host">
      <iframe
        ref={ref}
        title={app.manifest.name}
        src={app.entryUrl}
        sandbox="allow-scripts allow-forms"
        allow="autoplay; fullscreen"
        referrerPolicy="no-referrer"
      />
      {!ready && (
        <div className="miniapp-loading">
          <div className="spinner" />
          <p>{slow ? 'Ứng dụng chưa phản hồi. Nếu nó không dùng TV WebOS SDK, điều khiển bằng con trỏ có thể không hoạt động.' : 'Đang mở...'}</p>
        </div>
      )}
    </div>
  );
}
