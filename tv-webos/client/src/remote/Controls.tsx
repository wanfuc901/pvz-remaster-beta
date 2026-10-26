import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CornerDownLeft,
  Delete,
  LayoutGrid,
  Layers,
  Monitor,
  Pause,
  Play,
  Rewind,
  FastForward,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
  Bell,
  QrCode,
  PanelLeft,
  PanelRight,
  Maximize2,
  Minus,
  Send,
  ClipboardPaste,
  ExternalLink,
  Globe,
  Youtube,
  Plus,
  Maximize,
  Minimize,
} from 'lucide-react';
import { GamepadButton, type NavKey } from '@tvwebos/shared/constants';
import { firstHttpUrl, parseYouTube } from '@tvwebos/shared/links';
import type { TvMediaState } from '@tvwebos/shared';
import { clamp, formatDuration } from '../common/format';
import { local } from '../common/storage';
import { send, showToast, useRemote, vibrate } from './link';

/** Button that repeats while held (D-pad arrows). */
function HoldButton({ k, className, children, label }: { k: NavKey; className?: string; children: ReactNode; label: string }) {
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    stop();
    send({ k: 'key', key: k, a: 'press' });
    vibrate(8);
    const repeat = (delay: number) => {
      timer.current = window.setTimeout(() => {
        send({ k: 'key', key: k, a: 'press' });
        repeat(90);
      }, delay);
    };
    repeat(420);
  };
  return (
    <button
      className={className}
      aria-label={label}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

function KeyButton({ k, className, children, label }: { k: NavKey; className?: string; children: ReactNode; label: string }) {
  return (
    <button
      className={className}
      aria-label={label}
      onClick={() => {
        send({ k: 'key', key: k, a: 'press' });
        vibrate(10);
      }}
    >
      {children}
    </button>
  );
}

export function DPad() {
  return (
    <div className="dpad-panel">
      <div className="dpad">
        <HoldButton k="ArrowUp" className="dpad-btn up" label="Lên">
          <ChevronUp />
        </HoldButton>
        <HoldButton k="ArrowLeft" className="dpad-btn left" label="Trái">
          <ChevronLeft />
        </HoldButton>
        <KeyButton k="Enter" className="dpad-ok" label="OK">
          OK
        </KeyButton>
        <HoldButton k="ArrowRight" className="dpad-btn right" label="Phải">
          <ChevronRight />
        </HoldButton>
        <HoldButton k="ArrowDown" className="dpad-btn down" label="Xuống">
          <ChevronDown />
        </HoldButton>
      </div>
      <div className="dpad-actions">
        <KeyButton k="Back" className="r-btn" label="Quay lại">
          <ArrowLeft /> Quay lại
        </KeyButton>
        <button className="r-btn" onClick={() => send({ k: 'command', cmd: 'launcher' })}>
          <LayoutGrid /> Ứng dụng
        </button>
        <button className="r-btn" onClick={() => send({ k: 'command', cmd: 'switcher' })}>
          <Layers /> Cửa sổ
        </button>
      </div>
      <div className="color-keys">
        <KeyButton k="ColorRed" className="color-key red" label="Đỏ">
          {' '}
        </KeyButton>
        <KeyButton k="ColorGreen" className="color-key green" label="Xanh lá">
          {' '}
        </KeyButton>
        <KeyButton k="ColorYellow" className="color-key yellow" label="Vàng">
          {' '}
        </KeyButton>
        <KeyButton k="ColorBlue" className="color-key blue" label="Xanh dương">
          {' '}
        </KeyButton>
      </div>
      <div className="dpad-actions">
        <KeyButton k="MediaRewind" className="r-btn icon" label="Tua lại">
          <Rewind />
        </KeyButton>
        <KeyButton k="MediaPlayPause" className="r-btn icon" label="Phát/Dừng">
          <Play />
        </KeyButton>
        <KeyButton k="MediaFastForward" className="r-btn icon" label="Tua đi">
          <FastForward />
        </KeyButton>
      </div>
    </div>
  );
}

// ---- Keyboard -------------------------------------------------------------------

export function Keyboard() {
  const text = useRemote((s) => s.tv?.text ?? null);
  const [value, setValue] = useState(text?.value ?? '');
  const lastLocalEdit = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  // Follow the TV's value unless the user is typing right now.
  useEffect(() => {
    if (!text) return;
    if (Date.now() - lastLocalEdit.current > 800 && text.value !== value) setValue(text.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text?.value]);

  // Focus the phone field when a TV field gets focus (opens the phone keyboard on Android;
  // iOS only opens it from a direct tap).
  const focusedKey = text ? `${text.inputType}|${text.placeholder}` : null;
  useEffect(() => {
    if (focusedKey) inputRef.current?.focus();
  }, [focusedKey]);

  const onChange = (v: string) => {
    lastLocalEdit.current = Date.now();
    setValue(v);
    send({ k: 'text', op: 'set', value: v });
  };

  const submit = () => {
    send({ k: 'text', op: 'submit' });
    vibrate(10);
  };

  const isPassword = text?.inputType === 'password';
  return (
    <div className="keyboard-panel">
      {text ? (
        <div className="kb-status ok">Đang nhập vào ô trên TV{text.placeholder ? `: "${text.placeholder}"` : ''}</div>
      ) : (
        <div className="kb-status">Chưa có ô nhập liệu nào được chọn trên TV. Chọn một ô trên TV, hoặc dùng các phím bên dưới.</div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {text?.multiline ? (
          <textarea
            ref={inputRef}
            className="kb-input"
            rows={4}
            value={value}
            placeholder="Nhập văn bản..."
            onChange={(e) => onChange(e.target.value)}
            disabled={!text}
          />
        ) : (
          <input
            ref={inputRef}
            className="kb-input"
            type={isPassword ? 'password' : 'text'}
            value={value}
            placeholder={text ? 'Nhập văn bản...' : 'Không có ô nhập liệu'}
            onChange={(e) => onChange(e.target.value)}
            disabled={!text}
            autoCapitalize="off"
            autoCorrect="off"
            enterKeyHint="send"
          />
        )}
        <div className="kb-row">
          <button type="button" className="r-btn" disabled={!text} onClick={() => onChange('')}>
            <X /> Xóa hết
          </button>
          <button type="submit" className="r-btn primary" disabled={!text}>
            <Send /> Gửi (Enter)
          </button>
        </div>
      </form>
      <div className="kb-keys">
        {(
          [
            ['Tab', 'Tab'],
            ['Escape', 'Esc'],
            ['Backspace', 'Xóa lùi'],
            ['Delete', 'Del'],
            ['Home', 'Home'],
            ['End', 'End'],
            ['PageUp', 'PgUp'],
            ['PageDown', 'PgDn'],
          ] as Array<[NavKey, string]>
        ).map(([k, label]) => (
          <KeyButton key={k} k={k} className="r-btn small" label={label}>
            {k === 'Backspace' ? <Delete /> : label}
          </KeyButton>
        ))}
        <KeyButton k="Enter" className="r-btn small" label="Enter">
          <CornerDownLeft />
        </KeyButton>
      </div>
    </div>
  );
}

// ---- Gamepad --------------------------------------------------------------------

function PadButton({ bit, className, children, onChange }: { bit: number; className: string; children: ReactNode; onChange: (bit: number, down: boolean) => void }) {
  const [down, setDown] = useState(false);
  const set = (v: boolean) => {
    if (v === down) return;
    setDown(v);
    onChange(bit, v);
  };
  return (
    <button
      className={`${className} ${down ? 'down' : ''}`}
      onPointerDown={(e) => {
        e.preventDefault();
        // Touch pointers are implicitly captured; release so sliding off the button releases it.
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        set(true);
      }}
      onPointerUp={() => set(false)}
      onPointerLeave={() => set(false)}
      onPointerCancel={() => set(false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

export function Gamepad() {
  const buttons = useRef(0);
  const gamepadApp = useRemote((s) => s.tv?.gamepadApp ?? false);
  const onChange = (bit: number, down: boolean) => {
    buttons.current = down ? buttons.current | (1 << bit) : buttons.current & ~(1 << bit);
    send({ k: 'gamepad', buttons: buttons.current, axes: [0, 0] });
    if (down) vibrate(10);
  };
  // Release everything when leaving the panel.
  useEffect(
    () => () => {
      if (buttons.current) send({ k: 'gamepad', buttons: 0, axes: [0, 0] });
    },
    [],
  );
  return (
    <div className="gamepad-panel">
      <div className="gp-hint">
        {gamepadApp ? 'Ứng dụng đang mở nhận tay cầm trực tiếp.' : 'Tay cầm đang điều khiển giao diện: D-pad di chuyển, A = OK, B = Quay lại.'}
        {' '}Xoay ngang điện thoại để dễ cầm hơn.
      </div>
      <div className="gp-shoulders">
        <PadButton bit={GamepadButton.L1} className="gp-btn shoulder" onChange={onChange}>
          L
        </PadButton>
        <PadButton bit={GamepadButton.R1} className="gp-btn shoulder" onChange={onChange}>
          R
        </PadButton>
      </div>
      <div className="gp-main">
        <div className="gp-dpad">
          <PadButton bit={GamepadButton.UP} className="gp-btn d up" onChange={onChange}>
            <ChevronUp />
          </PadButton>
          <PadButton bit={GamepadButton.LEFT} className="gp-btn d left" onChange={onChange}>
            <ChevronLeft />
          </PadButton>
          <PadButton bit={GamepadButton.RIGHT} className="gp-btn d right" onChange={onChange}>
            <ChevronRight />
          </PadButton>
          <PadButton bit={GamepadButton.DOWN} className="gp-btn d down" onChange={onChange}>
            <ChevronDown />
          </PadButton>
        </div>
        <div className="gp-center">
          <PadButton bit={GamepadButton.SELECT} className="gp-btn pill" onChange={onChange}>
            SELECT
          </PadButton>
          <PadButton bit={GamepadButton.START} className="gp-btn pill" onChange={onChange}>
            START
          </PadButton>
        </div>
        <div className="gp-face">
          <PadButton bit={GamepadButton.Y} className="gp-btn f y" onChange={onChange}>
            Y
          </PadButton>
          <PadButton bit={GamepadButton.X} className="gp-btn f x" onChange={onChange}>
            X
          </PadButton>
          <PadButton bit={GamepadButton.B} className="gp-btn f b" onChange={onChange}>
            B
          </PadButton>
          <PadButton bit={GamepadButton.A} className="gp-btn f a" onChange={onChange}>
            A
          </PadButton>
        </div>
      </div>
    </div>
  );
}

// ---- Apps / windows -------------------------------------------------------------

export function AppsPanel() {
  const tv = useRemote((s) => s.tv);
  const windows = tv?.windows ?? [];
  const apps = tv?.apps ?? [];
  const cmd = (c: Parameters<typeof send>[0]) => {
    send(c);
    vibrate(10);
  };
  return (
    <div className="apps-panel">
      <div className="quick-cmds">
        <button className="r-btn" onClick={() => cmd({ k: 'command', cmd: 'show-desktop' })}>
          <Monitor /> Màn hình chính
        </button>
        <button className="r-btn" onClick={() => cmd({ k: 'command', cmd: 'launcher' })}>
          <LayoutGrid /> Ứng dụng
        </button>
        <button className="r-btn" onClick={() => cmd({ k: 'command', cmd: 'notifications' })}>
          <Bell /> Thông báo
        </button>
        <button className="r-btn" onClick={() => cmd({ k: 'command', cmd: 'pairing' })}>
          <QrCode /> Mã QR
        </button>
      </div>
      <h3>Cửa sổ đang mở ({windows.length})</h3>
      {windows.length === 0 && <p className="muted">Chưa có cửa sổ nào.</p>}
      {windows.map((w) => (
        <div key={w.id} className={`win-row ${w.focused ? 'focused' : ''}`}>
          <button className="win-title" onClick={() => cmd({ k: 'command', cmd: 'focus-window', arg: w.id })}>
            <span className="t">{w.title}</span>
            <span className="s">{w.focused ? 'Đang dùng' : w.state === 'minimized' ? 'Đã thu nhỏ' : 'Đang mở'}</span>
          </button>
          <div className="win-actions">
            <button className="r-btn icon" aria-label="Ghim trái" onClick={() => cmd({ k: 'command', cmd: 'snap-left', arg: w.id })}>
              <PanelLeft />
            </button>
            <button className="r-btn icon" aria-label="Ghim phải" onClick={() => cmd({ k: 'command', cmd: 'snap-right', arg: w.id })}>
              <PanelRight />
            </button>
            <button className="r-btn icon" aria-label="Thu nhỏ" onClick={() => cmd({ k: 'command', cmd: 'minimize-window', arg: w.id })}>
              <Minus />
            </button>
            <button className="r-btn icon" aria-label="Phóng to" onClick={() => cmd({ k: 'command', cmd: 'maximize-window', arg: w.id })}>
              <Maximize2 />
            </button>
            <button className="r-btn icon danger" aria-label="Đóng" onClick={() => cmd({ k: 'command', cmd: 'close-window', arg: w.id })}>
              <X />
            </button>
          </div>
        </div>
      ))}
      <h3>Mở ứng dụng</h3>
      <div className="app-launch-grid">
        {apps.map((a) => (
          <button key={a.id} className="r-btn" onClick={() => cmd({ k: 'command', cmd: 'launch-app', arg: a.id })}>
            {a.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Media ----------------------------------------------------------------------

const RECENT_LINKS_KEY = 'tvwebos.remote.links';
const RECENT_LINKS_LIMIT = 6;

/** A pasted value as a link: a URL inside any text, or a bare domain such as "coccoc.com". */
function linkFrom(value: string): string | null {
  const v = value.trim();
  const found = firstHttpUrl(v);
  if (found) return found;
  return /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(v) ? `https://${v}` : null;
}

function describeLink(url: string): string {
  const yt = parseYouTube(url);
  if (yt) return yt.videoId ? 'Video YouTube: phát trong ứng dụng YouTube trên TV' : 'Danh sách phát YouTube';
  return 'Trang web: mở trong trình duyệt trên TV';
}

function shortLink(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, '');
}

/** Paste or share a link and open it on the TV. `autoSend` fires once, for links arriving from the share sheet. */
export function LinkBox({ initial, autoSend }: { initial?: string | null; autoSend?: boolean }) {
  const tvOnline = useRemote((s) => s.tvOnline);
  const [value, setValue] = useState(initial ?? '');
  const [recent, setRecent] = useState<string[]>(() => local.getJson<string[]>(RECENT_LINKS_KEY, []));
  const autoSent = useRef(false);
  const url = linkFrom(value);
  const canPaste = typeof navigator.clipboard?.readText === 'function';

  const open = (link: string, target: 'auto' | 'tv-browser') => {
    send({ k: 'open', url: link, target });
    vibrate(15);
    showToast(target === 'auto' && parseYouTube(link) ? 'Đã gửi video tới TV' : 'Đã mở liên kết trên TV');
    const next = [link, ...recent.filter((r) => r !== link)].slice(0, RECENT_LINKS_LIMIT);
    setRecent(next);
    local.setJson(RECENT_LINKS_KEY, next);
  };

  useEffect(() => {
    if (!autoSend || autoSent.current || !tvOnline || !initial) return;
    const link = linkFrom(initial);
    if (!link) return;
    autoSent.current = true;
    open(link, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, initial, tvOnline]);

  const paste = async () => {
    try {
      setValue(await navigator.clipboard.readText());
    } catch {
      showToast('Không đọc được bộ nhớ tạm, hãy nhấn giữ ô bên dưới để dán');
    }
  };

  return (
    <div className="link-box">
      <div className="link-head">
        <span>Phát link trên TV</span>
        <button className="r-btn small" onClick={() => send({ k: 'command', cmd: 'launch-app', arg: 'youtube' })}>
          <Youtube /> YouTube
        </button>
      </div>
      <div className="link-row">
        <input
          className="r-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Dán link YouTube hoặc trang web"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          enterKeyHint="go"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url) open(url, 'auto');
          }}
        />
        {canPaste && (
          <button className="r-btn icon" aria-label="Dán" onClick={() => void paste()}>
            <ClipboardPaste />
          </button>
        )}
      </div>
      {url && <div className="link-kind">{describeLink(url)}</div>}
      <div className="kb-row">
        <button className="r-btn primary" disabled={!url} onClick={() => url && open(url, 'auto')}>
          <Play /> Phát trên TV
        </button>
        <button className="r-btn" disabled={!url} onClick={() => url && open(url, 'tv-browser')}>
          <ExternalLink /> Trình duyệt TV
        </button>
      </div>
      {recent.length > 0 && (
        <div className="link-recent">
          {recent.map((r) => (
            <button key={r} className="link-recent-item" onClick={() => open(r, 'auto')}>
              {parseYouTube(r) ? <Youtube /> : <Globe />}
              <span>{shortLink(r)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const SEEK_STEP_S = 10;
const VOLUME_STEP = 0.1;
/** Below this many pixels a touch is a tap, above it a swipe. */
const SWIPE_MIN_PX = 36;
/** A vertical swipe across 250 px moves the volume from 0 to 100 %. */
const VOLUME_PER_PX = 1 / 250;
const DOUBLE_TAP_MS = 280;

/**
 * Touch area for eyes-on-the-TV control, laid over the artwork: tap toggles playback, double tap on the
 * left / right half seeks 10 s, a horizontal swipe seeks 10 s per step, a vertical swipe sets the volume.
 */
function GesturePad({ media }: { media: TvMediaState }) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef<{ at: number; side: -1 | 1 } | null>(null);
  const tapTimer = useRef<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
    },
    [],
  );

  const flash = (text: string) => {
    setHint(text);
    window.setTimeout(() => setHint((h) => (h === text ? null : h)), 700);
  };

  const seekBy = (seconds: number) => {
    send({ k: 'media', cmd: 'seek-by', value: seconds });
    vibrate(12);
    flash(`${seconds > 0 ? '+' : ''}${seconds}s`);
  };

  const onTap = (side: -1 | 1) => {
    const now = Date.now();
    if (lastTap.current && now - lastTap.current.at < DOUBLE_TAP_MS && lastTap.current.side === side) {
      if (tapTimer.current !== null) clearTimeout(tapTimer.current);
      tapTimer.current = null;
      lastTap.current = null;
      seekBy(side * SEEK_STEP_S);
      return;
    }
    lastTap.current = { at: now, side };
    // Wait for a possible second tap before toggling, like YouTube's own player.
    tapTimer.current = window.setTimeout(() => {
      tapTimer.current = null;
      send({ k: 'media', cmd: 'toggle' });
      vibrate(10);
      flash(media.playing ? 'Tạm dừng' : 'Phát');
    }, DOUBLE_TAP_MS);
  };

  return (
    <div
      className="gesture-pad"
      style={media.art ? { backgroundImage: `url("${media.art}")` } : undefined}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const from = start.current;
        start.current = null;
        if (!from) return;
        const dx = e.clientX - from.x;
        const dy = e.clientY - from.y;
        if (Math.abs(dy) > SWIPE_MIN_PX && Math.abs(dy) > Math.abs(dx)) {
          const volume = clamp((media.muted ? 0 : media.volume) - dy * VOLUME_PER_PX, 0, 1);
          send({ k: 'media', cmd: 'volume', value: volume });
          vibrate(8);
          flash(`Âm lượng ${Math.round(volume * 100)}%`);
        } else if (Math.abs(dx) > SWIPE_MIN_PX) {
          seekBy(Math.sign(dx) * SEEK_STEP_S * Math.max(1, Math.round(Math.abs(dx) / (SWIPE_MIN_PX * 2))));
        } else {
          const r = e.currentTarget.getBoundingClientRect();
          onTap(e.clientX - r.left < r.width / 2 ? -1 : 1);
        }
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    >
      {!media.art && <div className="gesture-title">{media.title}</div>}
      {hint && <div className="gesture-hint">{hint}</div>}
    </div>
  );
}

export function MediaPanel({ sharedLink }: { sharedLink?: string | null }) {
  const media = useRemote((s) => s.tv?.media ?? null);
  const [seeking, setSeeking] = useState<number | null>(null);
  const linkBox = <LinkBox initial={sharedLink} autoSend={!!sharedLink} />;
  if (!media) {
    return (
      <div className="media-panel">
        {linkBox}
        <p className="muted">Không có nội dung đang phát. Gửi một link ở trên, hoặc mở video / nhạc trong Trình phát trên TV.</p>
      </div>
    );
  }
  const m = (cmd: 'toggle' | 'next' | 'prev' | 'mute' | 'fullscreen', value?: number) => {
    send({ k: 'media', cmd, value });
    vibrate(10);
  };
  const volume = media.muted ? 0 : media.volume;
  const commitSeek = () => {
    if (seeking !== null) send({ k: 'media', cmd: 'seek', value: seeking });
    setSeeking(null);
  };
  return (
    <div className="media-panel">
      <GesturePad media={media} />
      <p className="gesture-help muted small">Chạm: phát / dừng · Chạm đúp trái / phải: ±10 giây · Vuốt ngang: tua · Vuốt dọc: âm lượng</p>
      <div className="media-title">{media.title}</div>
      <input
        type="range"
        className="r-range"
        min={0}
        max={Math.max(1, media.duration)}
        step={1}
        value={seeking ?? media.time}
        onChange={(e) => setSeeking(Number(e.target.value))}
        onPointerUp={commitSeek}
        onTouchEnd={commitSeek}
      />
      <div className="media-time">
        <span>{formatDuration(seeking ?? media.time)}</span>
        <span>{formatDuration(media.duration)}</span>
      </div>
      <div className="media-buttons">
        <button className="r-btn icon big" aria-label="Trước" onClick={() => m('prev')}>
          <SkipBack />
        </button>
        <button className="r-btn icon big" aria-label="Lùi 10 giây" onClick={() => send({ k: 'media', cmd: 'seek-by', value: -SEEK_STEP_S })}>
          <Rewind />
        </button>
        <button className="r-btn icon huge primary" aria-label="Phát/Dừng" onClick={() => m('toggle')}>
          {media.playing ? <Pause /> : <Play />}
        </button>
        <button className="r-btn icon big" aria-label="Tiến 10 giây" onClick={() => send({ k: 'media', cmd: 'seek-by', value: SEEK_STEP_S })}>
          <FastForward />
        </button>
        <button className="r-btn icon big" aria-label="Tiếp" onClick={() => m('next')}>
          <SkipForward />
        </button>
      </div>
      <div className="media-volume">
        <button className="r-btn icon" aria-label={media.muted ? 'Bật tiếng' : 'Tắt tiếng'} onClick={() => m('mute')}>
          {media.muted ? <VolumeX /> : <Volume2 />}
        </button>
        <button className="r-btn icon" aria-label="Giảm âm lượng" onClick={() => send({ k: 'media', cmd: 'volume', value: clamp(volume - VOLUME_STEP, 0, 1) })}>
          <Minus />
        </button>
        <input
          type="range"
          className="r-range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => send({ k: 'media', cmd: 'volume', value: Number(e.target.value) / 100 })}
        />
        <button className="r-btn icon" aria-label="Tăng âm lượng" onClick={() => send({ k: 'media', cmd: 'volume', value: clamp(volume + VOLUME_STEP, 0, 1) })}>
          <Plus />
        </button>
      </div>
      <button className={`r-btn wide ${media.fullscreen ? 'on' : ''}`} onClick={() => m('fullscreen')}>
        {media.fullscreen ? <Minimize /> : <Maximize />} {media.fullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình trên TV'}
      </button>
      <p className="muted small">Âm lượng ở đây là của trình phát TV WebOS; âm lượng hệ thống TV chỉ chỉnh được bằng remote của TV.</p>
      {linkBox}
    </div>
  );
}
