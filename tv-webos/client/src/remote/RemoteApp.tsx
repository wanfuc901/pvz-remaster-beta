import { useEffect, useRef, useState } from 'react';
import { AppWindow, Film, Gamepad2, Keyboard as KeyboardIcon, Menu, MousePointer2, Move, Tv, Upload, X } from 'lucide-react';
import { firstHttpUrl } from '@tvwebos/shared/links';
import { getServerBase } from '../common/server';
import { local } from '../common/storage';
import { AppsPanel, DPad, Gamepad, Keyboard, MediaPanel } from './Controls';
import { defaultDeviceName, pairWithCode, reconnect, setDeviceName, startRemote, unpair, useRemote } from './link';
import { getSensitivity, Touchpad } from './Touchpad';

type Tab = 'touch' | 'dpad' | 'keyboard' | 'gamepad' | 'apps' | 'media';

const TABS: Array<{ id: Tab; label: string; icon: typeof Tv }> = [
  { id: 'touch', label: 'Chuột', icon: MousePointer2 },
  { id: 'dpad', label: 'Phím', icon: Move },
  { id: 'keyboard', label: 'Gõ chữ', icon: KeyboardIcon },
  { id: 'gamepad', label: 'Tay cầm', icon: Gamepad2 },
  { id: 'apps', label: 'Cửa sổ', icon: AppWindow },
  { id: 'media', label: 'Media', icon: Film },
];

function PairScreen() {
  const phase = useRemote((s) => s.phase);
  const verify = useRemote((s) => s.verifyCode);
  const tvName = useRemote((s) => s.tvName);
  const error = useRemote((s) => s.error);
  const socket = useRemote((s) => s.socket);
  const [code, setCode] = useState('');
  const [name, setName] = useState(defaultDeviceName());

  if (phase === 'pairing') {
    return (
      <div className="pair-screen">
        <div className="pair-box">
          <Tv className="pair-icon" />
          {verify ? (
            <>
              <h1>Xác nhận trên TV</h1>
              <p>Trên màn hình {tvName || 'TV'}, chọn "Cho phép" nếu mã bên dưới trùng với mã trên TV.</p>
              <div className="verify-code">{verify}</div>
            </>
          ) : (
            <>
              <h1>Đang ghép nối...</h1>
              <div className="r-spinner" />
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pair-screen">
      <div className="pair-box">
        <Tv className="pair-icon" />
        <h1>Ghép nối với TV</h1>
        <p>Mở camera điện thoại và quét mã QR trên TV (phím xanh dương trên remote TV hiện mã). Hoặc nhập mã 6 số hiển thị trên TV:</p>
        {error && <div className="r-error">{error.message}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const digits = code.replace(/\D/g, '');
            if (digits.length !== 6) return;
            setDeviceName(name.trim() || defaultDeviceName());
            pairWithCode(digits);
          }}
        >
          <input
            className="r-input code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="000 000"
            maxLength={7}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
          />
          <label className="r-label">
            Tên thiết bị
            <input className="r-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="r-btn primary wide" type="submit" disabled={code.replace(/\D/g, '').length !== 6 || socket !== 'open'}>
            Ghép nối
          </button>
        </form>
        {socket !== 'open' && <p className="muted small">Đang kết nối tới server {getServerBase()}...</p>}
      </div>
    </div>
  );
}

function uploadFile(file: File, token: string, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${getServerBase()}/api/files/upload?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = `HTTP ${xhr.status}`;
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
        } catch {
          // keep status text
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error('Lỗi mạng'));
    xhr.send(file);
  });
}

function MenuSheet({ onClose }: { onClose: () => void }) {
  const tvName = useRemote((s) => s.tvName);
  const token = useRemote((s) => s.apiToken);
  const latency = useRemote((s) => s.latencyMs);
  const [sens, setSens] = useState(getSensitivity());
  const [haptics, setHaptics] = useState(local.get('tvwebos.remote.haptics') !== 'off');
  const [upload, setUpload] = useState<{ name: string; progress: number; error?: string; done?: boolean } | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const sendFiles = async (files: FileList | null) => {
    if (!files || !token) return;
    for (const f of Array.from(files)) {
      setUpload({ name: f.name, progress: 0 });
      try {
        await uploadFile(f, token, (p) => setUpload({ name: f.name, progress: p }));
        setUpload({ name: f.name, progress: 1, done: true });
      } catch (err) {
        setUpload({ name: f.name, progress: 0, error: err instanceof Error ? err.message : String(err) });
        return;
      }
    }
  };

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <h2>{tvName || 'TV'}</h2>
          <button className="r-btn icon" aria-label="Đóng" onClick={onClose}>
            <X />
          </button>
        </div>
        <p className="muted small">Độ trễ: {latency !== null ? `${latency} ms` : '-'}</p>

        <h3>Gửi tệp tới TV</h3>
        <p className="muted small">Ảnh, video, nhạc được lưu vào thư mục "Uploads" của thư viện media và TV sẽ nhận thông báo.</p>
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => void sendFiles(e.target.files)} />
        <button className="r-btn wide" onClick={() => fileRef.current?.click()} disabled={!token}>
          <Upload /> Chọn tệp
        </button>
        {upload && (
          <div className="upload-status">
            <div className="small">{upload.name}</div>
            {upload.error ? (
              <div className="r-error">{upload.error}</div>
            ) : (
              <div className="progress">
                <span style={{ width: `${Math.round(upload.progress * 100)}%` }} />
              </div>
            )}
            {upload.done && <div className="small ok">Đã gửi</div>}
          </div>
        )}

        <h3>Độ nhạy con trỏ: {sens.toFixed(1)}</h3>
        <input
          type="range"
          className="r-range"
          min={0.6}
          max={4}
          step={0.1}
          value={sens}
          onChange={(e) => {
            const v = Number(e.target.value);
            setSens(v);
            local.set('tvwebos.remote.sens', String(v));
          }}
        />
        <p className="muted small">Áp dụng khi mở lại tab Chuột.</p>

        <label className="r-check">
          <input
            type="checkbox"
            checked={haptics}
            onChange={(e) => {
              setHaptics(e.target.checked);
              local.set('tvwebos.remote.haptics', e.target.checked ? 'on' : 'off');
            }}
          />
          Rung phản hồi (Android)
        </label>

        <h3>Thiết bị</h3>
        {confirmUnpair ? (
          <div className="r-row">
            <button className="r-btn" onClick={() => setConfirmUnpair(false)}>
              Hủy
            </button>
            <button
              className="r-btn danger"
              onClick={() => {
                unpair();
                onClose();
              }}
            >
              Xác nhận ngắt ghép nối
            </button>
          </div>
        ) : (
          <button className="r-btn danger wide" onClick={() => setConfirmUnpair(true)}>
            Ngắt ghép nối với TV
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBar({ onMenu }: { onMenu: () => void }) {
  const socket = useRemote((s) => s.socket);
  const tvOnline = useRemote((s) => s.tvOnline);
  const tvName = useRemote((s) => s.tvName);
  const ok = socket === 'open' && tvOnline;
  const label = socket !== 'open' ? 'Đang kết nối lại...' : tvOnline ? 'Đã kết nối' : 'TV đang tắt hoặc mất mạng';
  return (
    <header className="r-header">
      <div className="r-tv">
        <span className={`r-dot ${ok ? 'on' : socket === 'open' ? 'warn' : ''}`} />
        <div>
          <div className="r-tvname">{tvName || 'TV'}</div>
          <div className="r-status">{label}</div>
        </div>
      </div>
      {socket !== 'open' && (
        <button className="r-btn small" onClick={reconnect}>
          Thử lại
        </button>
      )}
      <button className="r-btn icon" aria-label="Menu" onClick={onMenu}>
        <Menu />
      </button>
    </header>
  );
}

const SHARE_PARAMS = ['url', 'text', 'title'];

/**
 * A link handed over by the phone's share sheet (manifest `share_target`, e.g. "Share" in the YouTube
 * app). Apps put it in different fields, so all are searched. Read once, then dropped from the address
 * bar so a reload does not send it again; the pairing token in the fragment is left alone.
 */
function takeSharedLink(): string | null {
  const params = new URLSearchParams(location.search);
  if (!SHARE_PARAMS.some((p) => params.has(p))) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  return firstHttpUrl(SHARE_PARAMS.map((p) => params.get(p) ?? '').join(' '));
}

/**
 * Keep the phone screen on while it is used as a remote. The OS drops the lock whenever the page is
 * hidden, so it is requested again on return. Unsupported (older iOS) or refused (battery saver): the
 * screen simply dims as usual.
 */
function useScreenWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (stopped) void lock.release();
      } catch {
        // Refused, see above.
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      if (lock && !lock.released) void lock.release();
    };
  }, [active]);
}

export function RemoteApp() {
  const phase = useRemote((s) => s.phase);
  const text = useRemote((s) => s.tv?.text ?? null);
  const hasMedia = useRemote((s) => !!s.tv?.media);
  const toast = useRemote((s) => s.toast);
  const [sharedLink] = useState(takeSharedLink);
  const [tab, setTab] = useState<Tab>(() => (sharedLink ? 'media' : (local.get('tvwebos.remote.tab') as Tab) || 'touch'));
  const [menu, setMenu] = useState(false);
  const prevTab = useRef<Tab | null>(null);
  useScreenWakeLock(phase === 'paired');

  useEffect(() => {
    startRemote();
  }, []);

  useEffect(() => {
    local.set('tvwebos.remote.tab', tab);
  }, [tab]);

  // Jump to the keyboard when a TV text field gets focus, and back afterwards.
  const textKey = text ? `${text.inputType}|${text.placeholder}` : null;
  useEffect(() => {
    if (textKey && tab !== 'keyboard') {
      prevTab.current = tab;
      setTab('keyboard');
    } else if (!textKey && tab === 'keyboard' && prevTab.current) {
      setTab(prevTab.current);
      prevTab.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textKey]);

  if (phase === 'connecting') {
    return (
      <div className="pair-screen">
        <div className="r-spinner" />
      </div>
    );
  }
  if (phase !== 'paired') return <PairScreen />;

  return (
    <div className="remote">
      <StatusBar onMenu={() => setMenu(true)} />
      <main className="r-main">
        {tab === 'touch' && <Touchpad />}
        {tab === 'dpad' && <DPad />}
        {tab === 'keyboard' && <Keyboard />}
        {tab === 'gamepad' && <Gamepad />}
        {tab === 'apps' && <AppsPanel />}
        {tab === 'media' && <MediaPanel sharedLink={sharedLink} />}
      </main>
      <nav className="r-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`r-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => {
              prevTab.current = null;
              setTab(t.id);
            }}
          >
            <t.icon />
            <span>{t.label}</span>
            {t.id === 'media' && hasMedia && <i className="r-tab-dot" />}
          </button>
        ))}
      </nav>
      {menu && <MenuSheet onClose={() => setMenu(false)} />}
      {toast && <div className="r-toast">{toast}</div>}
    </div>
  );
}
