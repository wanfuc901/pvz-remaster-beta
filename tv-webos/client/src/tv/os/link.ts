/**
 * The TV's connection to the server: identity, pairing and relaying
 * remote input / TV state.
 */
import { PROTOCOL_VERSION } from '@tvwebos/shared/constants';
import type { ClientMessage, ServerMessage, TvState } from '@tvwebos/shared';
import { ReconnectingSocket } from '../../common/socket';
import { wsUrl } from '../../common/server';
import { local } from '../../common/storage';
import { formatBytes } from '../../common/format';
import { allApps, appDescriptor, launch } from './apps';
import { activeMedia, onMediaChange } from './bus';
import { handleRemoteInput } from './remoteInput';
import { os, useOs } from './store';
import { currentTextFocus, onTextFocus } from './textBridge';

const CREDS_KEY = 'tvwebos.tv';

interface Creds {
  deviceId: string;
  secret: string;
}

let socket: ReconnectingSocket | null = null;

export function sendToServer(msg: ClientMessage): boolean {
  return socket ? socket.send(msg) : false;
}

export function startLink(serverBase: string): void {
  stopLink();
  os.get().setLink({ serverBase, status: 'connecting' });
  socket = new ReconnectingSocket({
    url: wsUrl(serverBase),
    fatalCodes: [4004],
    onOpen: (s) => {
      const creds = local.getJson<Creds | null>(CREDS_KEY, null);
      s.send({
        t: 'tv.hello',
        v: PROTOCOL_VERSION,
        name: os.get().settings.deviceName,
        ...(creds ? { deviceId: creds.deviceId, secret: creds.secret } : {}),
      });
    },
    onMessage: onMessage,
    onStatus: (status, info) => {
      const link = os.get().link;
      const next =
        status === 'open' ? (link.status === 'online' ? 'online' : 'connecting') : status === 'connecting' ? 'connecting' : 'offline';
      os.get().setLink({ status: next, retryInMs: info.retryInMs, latencyMs: info.latencyMs });
    },
    onFatal: (code) => {
      if (code === 4004) os.get().setLink({ status: 'replaced' });
    },
  });
  socket.start();
  startStatePublisher();
}

export function stopLink(): void {
  socket?.stop();
  socket = null;
}

export function reconnectLink(): void {
  socket?.reconnect();
}

function onMessage(msg: ServerMessage): void {
  const s = os.get();
  switch (msg.t) {
    case 'tv.welcome': {
      local.setJson(CREDS_KEY, { deviceId: msg.deviceId, secret: msg.secret });
      s.setLink({
        status: 'online',
        deviceId: msg.deviceId,
        tvName: msg.name,
        apiToken: msg.apiToken,
        remotes: msg.remotes,
        serverSettings: msg.settings,
        pairRequests: [],
      });
      if (msg.name !== s.settings.deviceName) s.updateSettings({ deviceName: msg.name });
      socket?.send({ t: 'tv.pair.create' });
      lastSent = '';
      publishState();
      return;
    }
    case 'api.token':
      s.setLink({ apiToken: msg.apiToken });
      return;
    case 'tv.pair.code': {
      const { t: _t, ...code } = msg;
      s.setLink({ pairCode: code });
      return;
    }
    case 'tv.pair.request': {
      const { t: _t, ...req } = msg;
      s.setLink({ pairRequests: [...s.link.pairRequests.filter((r) => r.requestId !== req.requestId), req] });
      return;
    }
    case 'tv.pair.resolved': {
      const req = s.link.pairRequests.find((r) => r.requestId === msg.requestId);
      s.setLink({ pairRequests: s.link.pairRequests.filter((r) => r.requestId !== msg.requestId) });
      if (req && msg.approved) s.notify({ title: 'Đã ghép nối điện thoại', body: req.name, level: 'success' });
      else if (req && msg.reason === 'timeout') s.notify({ title: 'Yêu cầu ghép nối đã hết hạn', body: req.name, level: 'warning' });
      return;
    }
    case 'tv.remotes': {
      const before = new Set(s.link.remotes.filter((r) => r.online).map((r) => r.id));
      for (const r of msg.remotes) {
        if (r.online && !before.has(r.id)) s.notify({ title: 'Điện thoại đã kết nối', body: r.name, level: 'info' });
      }
      s.setLink({ remotes: msg.remotes });
      return;
    }
    case 'tv.settings':
      s.setLink({ serverSettings: msg.settings });
      return;
    case 'tv.input':
      handleRemoteInput(msg.from, msg.e);
      return;
    case 'tv.file.received':
      s.notify({
        title: `Đã nhận tệp từ ${msg.from}`,
        body: `${msg.name} (${formatBytes(msg.size)})`,
        level: 'success',
        actions: [
          { label: 'Mở', run: () => openReceivedFile(msg.path, msg.name) },
          { label: 'Mở thư mục', run: () => launch('files', { volume: 'server', path: 'Uploads' }) },
        ],
      });
      return;
    case 'error':
      if (msg.code === 'replaced') s.setLink({ status: 'replaced' });
      else if (msg.code !== 'rate_limited') console.warn('[link]', msg.code, msg.message);
      return;
    default:
      return;
  }
}

function openReceivedFile(path: string, name: string): void {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) launch('gallery', { path });
  else if (['mp4', 'webm', 'mkv', 'mov', 'm4v', 'mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus'].includes(ext)) {
    launch('media', { path });
  } else launch('files', { volume: 'server', path: 'Uploads' });
}

// ---- State publishing --------------------------------------------------------

let lastSent = '';
let publishTimer: number | null = null;
let publisherStarted = false;

function buildState(): TvState {
  const s = os.get();
  const focused = s.windows.find((w) => w.id === s.focusedId);
  const focusedApp = focused ? appDescriptor(focused.appId) : null;
  const media = activeMedia(s.focusedId)?.getState() ?? null;
  const overlay = s.link.pairRequests.length ? 'dialog' : s.overlay;
  return {
    windows: s.windows.slice(0, 64).map((w) => ({
      id: w.id,
      appId: w.appId,
      title: w.title.slice(0, 256),
      state: w.mode,
      focused: w.id === s.focusedId,
    })),
    apps: allApps(s)
      .slice(0, 256)
      .map((a) => ({ id: a.id, name: a.name.slice(0, 256), kind: a.kind })),
    text: s.settings.remoteAutoKeyboard ? currentTextFocus() : null,
    media,
    overlay,
    gamepadApp: !!focusedApp?.wantsGamepad,
  };
}

export function publishState(): void {
  if (publishTimer !== null) return;
  publishTimer = window.setTimeout(() => {
    publishTimer = null;
    if (os.get().link.status !== 'online') return;
    const state = buildState();
    const json = JSON.stringify(state);
    if (json === lastSent) return;
    if (sendToServer({ t: 'tv.state', state })) lastSent = json;
  }, 80);
}

function startStatePublisher(): void {
  if (publisherStarted) return;
  publisherStarted = true;
  useOs.subscribe((s, prev) => {
    if (
      s.windows !== prev.windows ||
      s.focusedId !== prev.focusedId ||
      s.overlay !== prev.overlay ||
      s.miniapps !== prev.miniapps ||
      s.tvApps !== prev.tvApps ||
      s.link.pairRequests !== prev.link.pairRequests ||
      s.settings.remoteAutoKeyboard !== prev.settings.remoteAutoKeyboard
    ) {
      publishState();
    }
  });
  onTextFocus(() => publishState());
  onMediaChange(() => publishState());
}
