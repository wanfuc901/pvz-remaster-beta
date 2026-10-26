import { useEffect, useRef } from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { appDescriptor, launch } from '../os/apps';
import { mountCursor } from '../os/cursor';
import { reconnectLink } from '../os/link';
import { useOs } from '../os/store';
import { AppIcon } from './AppIcon';
import { formatLongDate, formatTime, useNow } from './Clock';
import { Launcher, NotificationCenter, Switcher, Toasts } from './Overlays';
import { PairCard, PairingOverlay, PairRequestDialog } from './Pairing';
import { Taskbar } from './Taskbar';
import { WindowFrame } from './WindowFrame';

function Home({ hidden }: { hidden: boolean }) {
  const pinned = useOs((s) => s.pinned);
  const remotes = useOs((s) => s.link.remotes.length);
  const h24 = useOs((s) => s.settings.clock24h);
  useOs((s) => s.miniapps);
  const now = useNow(60_000);
  const hour = now.getHours();
  const greeting = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const apps = pinned.map((id) => appDescriptor(id)).filter(Boolean);
  return (
    <div className={`home ${hidden ? 'behind' : ''}`} data-desktop-home data-nav-scope {...(hidden ? { 'data-nav-hidden': '' } : {})}>
      <div className="home-top">
        <div className="home-clock">
          <div className="time">{formatTime(now, h24, false)}</div>
          <div className="date">
            {greeting} · {formatLongDate(now)}
          </div>
        </div>
        {remotes === 0 && <PairCard />}
      </div>
      <div className="home-apps">
        <div className="home-section-title">Ứng dụng</div>
        <div className="tile-row">
          {apps.map((app, i) => (
            <button key={app!.id} className="tile" onClick={() => launch(app!.id)} {...(i === 0 ? { 'data-nav-default': '' } : {})}>
              <div className="tile-art" style={{ background: app!.color }}>
                {app!.iconUrl ? <img src={app!.iconUrl} alt="" /> : app!.glyph ?? <AppIcon app={app!} />}
              </div>
              <span className="tile-label">{app!.name}</span>
            </button>
          ))}
          <button className="tile" onClick={() => launch('store')}>
            <div className="tile-art" style={{ background: 'var(--surface-3)' }}>
              <span style={{ fontSize: '3rem', fontWeight: 300, color: 'var(--text)' }}>+</span>
            </div>
            <span className="tile-label">Thêm ứng dụng</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectionBanner() {
  const status = useOs((s) => s.link.status);
  const retry = useOs((s) => s.link.retryInMs);
  if (status === 'online' || status === 'idle') return null;
  const text =
    status === 'replaced'
      ? 'TV WebOS đã được mở ở một cửa sổ khác. Phiên này đã dừng.'
      : status === 'connecting'
        ? 'Đang kết nối tới server...'
        : `Mất kết nối server. Thử lại sau ${Math.ceil(retry / 1000)} giây.`;
  return (
    <div className="conn-banner" data-nav-skip>
      <CloudOff />
      {text}
      {status === 'replaced' ? (
        <button className="btn" onClick={() => location.reload()}>
          Tải lại
        </button>
      ) : (
        status === 'offline' && (
          <button className="btn" onClick={() => reconnectLink()}>
            <RefreshCw /> Thử ngay
          </button>
        )
      )}
    </div>
  );
}

function Cursor() {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useOs((s) => s.cursorVisible);
  useEffect(() => {
    if (ref.current) mountCursor(ref.current);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('vcursor-active', visible);
  }, [visible]);
  return (
    <div ref={ref} className={`vcursor ${visible ? 'visible' : ''}`}>
      <svg viewBox="0 0 32 32">
        <path d="M5 3 L5 25 L11 19.5 L15 28.5 L19 26.8 L15 18 L23 18 Z" fill="#fff" stroke="#111" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function Desktop() {
  const windows = useOs((s) => s.windows);
  const focusedId = useOs((s) => s.focusedId);
  const overlay = useOs((s) => s.overlay);
  const wallpaper = useOs((s) => s.settings.wallpaper);
  const fullscreenId = useOs((s) => s.fullscreenId);
  const anyVisible = windows.some((w) => w.mode !== 'minimized');
  // Full screen only while that window is in front: switching to another window brings the chrome back.
  const immersiveId = fullscreenId && fullscreenId === focusedId ? fullscreenId : null;

  return (
    <div className={`desktop ${immersiveId ? 'immersive' : ''}`}>
      <div className={`wallpaper wp-${wallpaper}`} />
      <div className="safe-area">
        <div className="work-area" data-nav-scope {...(overlay !== 'none' ? { 'data-nav-hidden': '' } : {})}>
          <Home hidden={anyVisible} />
          {windows.map((w) => (
            <WindowFrame key={w.id} win={w} focused={w.id === focusedId} fullscreen={w.id === immersiveId} />
          ))}
        </div>
        <div {...(overlay !== 'none' ? { 'data-nav-hidden': '' } : {})}>
          <Taskbar />
        </div>
        {overlay === 'launcher' && <Launcher />}
        {overlay === 'switcher' && <Switcher />}
        {overlay === 'notifications' && <NotificationCenter />}
        {overlay === 'pairing' && <PairingOverlay />}
        <Toasts />
        <ConnectionBanner />
        <PairRequestDialog />
      </div>
      <Cursor />
    </div>
  );
}
