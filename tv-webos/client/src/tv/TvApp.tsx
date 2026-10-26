import { useEffect, useState } from 'react';
import { Tv } from 'lucide-react';
import { getServerBase, normalizeServerUrl, setServerBase } from '../common/server';
import { startLink } from './os/link';
import { loadInstalled } from './os/miniapps';
import { restoreSession, startSessionSaver } from './os/session';
import { initShellKeys } from './os/shell';
import { os, useOs } from './os/store';
import { initTextBridge } from './os/textBridge';
import { detectPlatform, type Capabilities } from './platform/webos';
import { Desktop } from './shell/Desktop';

export let platformCaps: Capabilities | null = null;

/** Pick a motion level for "auto": reduced on weak or old TV engines. */
function resolveMotion(setting: string): 'full' | 'reduced' | 'off' {
  if (setting === 'full' || setting === 'reduced' || setting === 'off') return setting;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced';
  } catch {
    // ignore
  }
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent);
  const chromeMajor = chrome ? Number(chrome[1]) : 999;
  if (cores <= 2 || (mem !== undefined && mem <= 1) || chromeMajor < 79) return 'reduced';
  return 'full';
}

function useAppearance() {
  const settings = useOs((s) => s.settings);
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', settings.theme);
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--safe', `${settings.safeArea}%`);
    const motion = resolveMotion(settings.motion);
    root.classList.remove('motion-full', 'motion-reduced', 'motion-off');
    root.classList.add(`motion-${motion}`);
    const apply = () => {
      // 16px per rem at 1920x1080, scaled with the viewport (4K browsers reporting 3840 CSS px get 32px).
      const base = Math.min(window.innerWidth / 1920, window.innerHeight / 1080) * 16;
      root.style.fontSize = `${Math.max(8, base * settings.scale)}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [settings]);
}

function SetupScreen({ onDone, error }: { onDone: (url: string) => void; error?: string }) {
  const [value, setValue] = useState('');
  const [err, setErr] = useState(error ?? '');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const url = normalizeServerUrl(value);
    if (!url) {
      setErr('Địa chỉ không hợp lệ. Ví dụ: 192.168.1.10:8686');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(url + '/api/info');
      const info = (await res.json()) as { name?: string };
      if (info.name !== 'TV WebOS') throw new Error('not tvwebos');
      setServerBase(url);
      onDone(url);
    } catch {
      setErr('Không kết nối được tới server TV WebOS tại địa chỉ này.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="setup">
      <div className="wallpaper wp-aurora" />
      <div className="setup-card" data-nav-scope data-nav-trap>
        <div className="app-glyph" style={{ width: '4.5rem', height: '4.5rem', background: '#4f8cff', marginBottom: '1.2rem' }}>
          <Tv />
        </div>
        <h1>Kết nối tới server TV WebOS</h1>
        <p>
          Nhập địa chỉ máy đang chạy server TV WebOS trong mạng nội bộ (hiển thị trong cửa sổ dòng lệnh khi chạy
          <code> npm start</code>).
        </p>
        <form
          className="setup-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            className="text-input"
            placeholder="192.168.1.10:8686"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            data-nav-default
            inputMode="url"
          />
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Đang kiểm tra...' : 'Kết nối'}
          </button>
        </form>
        {err && <div className="setup-error">{err}</div>}
      </div>
    </div>
  );
}

let booted = false;

export function TvApp() {
  useAppearance();
  const [server, setServer] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (booted) return;
    booted = true;
    initShellKeys();
    initTextBridge();
    void (async () => {
      platformCaps = await detectPlatform();
      await loadInstalled();
      const restored = await restoreSession();
      startSessionSaver();
      if (restored) os.get().notify({ title: 'Đã khôi phục phiên làm việc', body: `${restored} cửa sổ`, level: 'info' });
      setServer(getServerBase());
    })();
  }, []);

  useEffect(() => {
    if (server) startLink(server);
  }, [server]);

  if (server === undefined) return null;
  if (server === null) return <SetupScreen onDone={setServer} />;
  return <Desktop />;
}
