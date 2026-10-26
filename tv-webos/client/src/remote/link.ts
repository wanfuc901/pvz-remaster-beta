/**
 * Phone side of the connection: pairing, resume, sending input, mirroring TV state.
 */
import { create } from 'zustand';
import { PROTOCOL_VERSION, type ErrorCode } from '@tvwebos/shared/constants';
import type { InputEvent, ServerMessage, TvState } from '@tvwebos/shared';
import { ReconnectingSocket } from '../common/socket';
import { getServerBase, wsUrl } from '../common/server';
import { local } from '../common/storage';

const CREDS_KEY = 'tvwebos.remote';
const NAME_KEY = 'tvwebos.remote.name';

interface Creds {
  remoteId: string;
  token: string;
  tvId: string;
  tvName: string;
}

export type Phase = 'connecting' | 'unpaired' | 'pairing' | 'paired';

export interface RemoteState {
  phase: Phase;
  socket: 'connecting' | 'open' | 'closed';
  latencyMs: number | null;
  tvOnline: boolean;
  tvName: string;
  verifyCode: string | null;
  error: { code: ErrorCode | 'network'; message: string } | null;
  tv: TvState | null;
  apiToken: string | null;
  toast: string | null;
}

export const useRemote = create<RemoteState>(() => ({
  phase: 'connecting',
  socket: 'connecting',
  latencyMs: null,
  tvOnline: false,
  tvName: local.getJson<Creds | null>(CREDS_KEY, null)?.tvName ?? '',
  verifyCode: null,
  error: null,
  tv: null,
  apiToken: null,
  toast: null,
}));

const set = useRemote.setState;
const get = useRemote.getState;

let socket: ReconnectingSocket | null = null;
/** QR token taken from the URL fragment; used once. */
let pendingToken: string | null = null;
let pendingCode: string | null = null;

export function defaultDeviceName(): string {
  const saved = local.get(NAME_KEY);
  if (saved) return saved;
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  const android = /Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(ua);
  if (android && android[1] && !/^(wv|K)$/.test(android[1].trim())) return android[1].trim().slice(0, 40);
  if (/Android/.test(ua)) return 'Điện thoại Android';
  return 'Trình duyệt';
}

export function platformName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Web';
}

export function setDeviceName(name: string): void {
  local.set(NAME_KEY, name.slice(0, 64));
}

function creds(): Creds | null {
  return local.getJson<Creds | null>(CREDS_KEY, null);
}

function authenticate(s: ReconnectingSocket): void {
  const c = creds();
  const name = defaultDeviceName();
  if (pendingToken || pendingCode) {
    const token = pendingToken;
    const code = pendingCode;
    pendingToken = null;
    pendingCode = null;
    set({ phase: 'pairing', verifyCode: null, error: null });
    s.send({ t: 'remote.pair', v: PROTOCOL_VERSION, name, platform: platformName(), ...(token ? { token } : { code: code! }) });
    return;
  }
  if (c) {
    s.send({ t: 'remote.resume', v: PROTOCOL_VERSION, remoteId: c.remoteId, token: c.token });
    return;
  }
  set({ phase: 'unpaired' });
}

function onMessage(msg: ServerMessage): void {
  switch (msg.t) {
    case 'remote.pending':
      set({ phase: 'pairing', verifyCode: msg.verifyCode, tvName: msg.tvName, error: null });
      return;
    case 'remote.paired':
      local.setJson(CREDS_KEY, { remoteId: msg.remoteId, token: msg.token, tvId: msg.tvId, tvName: msg.tvName });
      return;
    case 'remote.welcome': {
      const c = creds();
      if (c && c.tvName !== msg.tvName) local.setJson(CREDS_KEY, { ...c, tvName: msg.tvName });
      set({ phase: 'paired', tvName: msg.tvName, tvOnline: msg.tvOnline, apiToken: msg.apiToken, verifyCode: null, error: null });
      return;
    }
    case 'api.token':
      set({ apiToken: msg.apiToken });
      return;
    case 'remote.tv.status':
      set({ tvOnline: msg.online, tvName: msg.tvName, ...(msg.online ? {} : { tv: null }) });
      return;
    case 'remote.tv.state':
      set({ tv: msg.state, tvOnline: true });
      return;
    case 'remote.tv.event':
      if (msg.event.type === 'haptic') vibrate(msg.event.pattern);
      else if (msg.event.type === 'toast') showToast(msg.event.message);
      return;
    case 'remote.revoked':
      local.remove(CREDS_KEY);
      set({ phase: 'unpaired', tv: null, error: { code: 'revoked', message: 'Điện thoại này đã bị gỡ khỏi TV. Quét lại mã QR để ghép nối.' } });
      return;
    case 'error':
      handleError(msg.code, msg.message);
      return;
    default:
      return;
  }
}

const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  pair_invalid: 'Mã ghép nối không đúng hoặc đã được dùng. Hãy quét mã QR mới trên TV.',
  pair_expired: 'Mã ghép nối đã hết hạn. Hãy quét mã QR mới trên TV.',
  pair_rejected: 'TV đã từ chối yêu cầu ghép nối.',
  pair_timeout: 'TV không xác nhận kịp. Hãy thử lại.',
  too_many_remotes: 'TV đã đạt số điện thoại tối đa. Gỡ bớt thiết bị trong Cài đặt trên TV.',
  tv_offline: 'TV đang ngoại tuyến.',
  rate_limited: 'Thử quá nhiều lần. Vui lòng đợi một chút.',
  auth_invalid: 'Phiên ghép nối không còn hợp lệ. Hãy quét lại mã QR.',
};

function handleError(code: ErrorCode, message: string): void {
  const text = ERROR_TEXT[code] ?? message;
  if (code === 'auth_invalid') {
    local.remove(CREDS_KEY);
    set({ phase: 'unpaired', error: { code, message: text } });
    return;
  }
  if (code === 'tv_offline' && get().phase === 'paired') {
    set({ tvOnline: false });
    return;
  }
  if (code.startsWith('pair_') || code === 'too_many_remotes' || (code === 'tv_offline' && get().phase !== 'paired')) {
    set({ phase: 'unpaired', verifyCode: null, error: { code, message: text } });
    return;
  }
  if (code === 'rate_limited') {
    if (get().phase === 'pairing') set({ phase: 'unpaired' });
    set({ error: { code, message: text } });
  }
}

export function startRemote(): void {
  // Take the one-time pairing token from the fragment and drop it from the address bar.
  const m = /[#&]pair=([^&]+)/.exec(location.hash);
  if (m) {
    pendingToken = decodeURIComponent(m[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const base = getServerBase();
  if (!base) {
    set({ phase: 'unpaired', error: { code: 'network', message: 'Không xác định được địa chỉ server.' } });
    return;
  }
  socket = new ReconnectingSocket({
    url: wsUrl(base),
    fatalCodes: [],
    onOpen: authenticate,
    onMessage,
    onStatus: (status, info) => set({ socket: status, latencyMs: info.latencyMs }),
  });
  socket.start();
}

/** Pair with a manually entered 6-digit code. */
export function pairWithCode(code: string): void {
  pendingCode = code;
  set({ error: null, phase: 'pairing', verifyCode: null });
  if (socket?.status === 'open') socket.reconnect();
}

export function unpair(): void {
  if (get().phase === 'paired') socket?.send({ t: 'remote.unpair' });
  local.remove(CREDS_KEY);
  set({ phase: 'unpaired', tv: null, error: null });
}

export function reconnect(): void {
  socket?.reconnect();
}

// ---- Input --------------------------------------------------------------------

let moveX = 0;
let moveY = 0;
let scrollX = 0;
let scrollY = 0;
let flushScheduled = false;

function flush(): void {
  flushScheduled = false;
  const events: InputEvent[] = [];
  if (moveX || moveY) {
    events.push({ k: 'move', dx: Math.round(moveX * 10) / 10, dy: Math.round(moveY * 10) / 10 });
    moveX = moveY = 0;
  }
  if (scrollX || scrollY) {
    events.push({ k: 'scroll', dx: Math.round(scrollX), dy: Math.round(scrollY) });
    scrollX = scrollY = 0;
  }
  if (events.length) socket?.send({ t: 'inputs', e: events });
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  requestAnimationFrame(flush);
}

/** Pointer movement is coalesced to one message per frame. */
export function queueMove(dx: number, dy: number): void {
  moveX += dx;
  moveY += dy;
  scheduleFlush();
}

export function queueScroll(dx: number, dy: number): void {
  scrollX += dx;
  scrollY += dy;
  scheduleFlush();
}

/** Discrete events are sent immediately, after any pending movement so ordering is kept. */
export function send(e: InputEvent): void {
  if (moveX || moveY || scrollX || scrollY) flush();
  socket?.send({ t: 'input', e });
}

// ---- Feedback -------------------------------------------------------------------

export function vibrate(pattern: number | number[]): void {
  if (local.get('tvwebos.remote.haptics') === 'off') return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // unsupported (iOS Safari)
  }
}

let toastTimer: number | null = null;
export function showToast(message: string): void {
  set({ toast: message });
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => set({ toast: null }), 2500);
}
