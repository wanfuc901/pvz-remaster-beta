/**
 * WebSocket hub: authenticates TVs and remotes, runs the pairing handshake
 * and relays input / state between a TV and its paired remotes.
 */
import type { IncomingMessage } from 'node:http';
import QRCode from 'qrcode';
import { WebSocket, WebSocketServer } from 'ws';
import {
  ClientMessageSchema,
  HEARTBEAT_TIMEOUT_MS,
  MAX_WS_PAYLOAD,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ErrorCode,
  type InputEvent,
  type ServerMessage,
  type TvState,
} from '@tvwebos/shared';
import type { Config } from '../config.js';
import { log } from '../core/log.js';
import { resolvePublicBase } from '../core/network.js';
import { PairingManager, type PendingRequest } from '../core/pairing.js';
import { KeyedRateLimiter, TokenBucket } from '../core/rateLimit.js';
import type { DeviceStore } from '../core/store.js';
import { API_TOKEN_TTL_MS, type TokenSigner } from '../core/tokens.js';

type Role = 'anon' | 'tv' | 'remote' | 'pairing';

interface Conn {
  ws: WebSocket;
  ip: string;
  host?: string;
  proto?: string;
  role: Role;
  tvId?: string;
  remoteId?: string;
  pendingRequestId?: string;
  lastSeen: number;
  bucket: TokenBucket;
  badFrames: number;
  lastOfflineNotice: number;
  apiTimer?: NodeJS.Timeout;
}

const AUTH_DEADLINE_MS = 10_000;

export interface HubDeps {
  config: Config;
  store: DeviceStore;
  signer: TokenSigner;
  pairing?: PairingManager;
  now?: () => number;
}

export class Hub {
  readonly wss: WebSocketServer;
  private readonly tvs = new Map<string, Conn>();
  private readonly remotes = new Map<string, Set<Conn>>();
  private readonly lastState = new Map<string, TvState>();
  private readonly conns = new Set<Conn>();
  private readonly connLimiter = new KeyedRateLimiter(30, 2);
  private readonly pairLimiter: KeyedRateLimiter;
  private readonly tvCreateLimiter = new KeyedRateLimiter(30, 30 / 3600);
  private readonly pairing: PairingManager;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: HubDeps) {
    this.pairing = deps.pairing ?? new PairingManager();
    this.now = deps.now ?? Date.now;
    const perMin = deps.config.pairAttemptsPerMinute;
    this.pairLimiter = new KeyedRateLimiter(perMin, perMin / 60, this.now);
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD, perMessageDeflate: false });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), 5_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const c of this.conns) c.ws.close(1001, 'server shutdown');
  }

  /** Called by the HTTP server for upgrade requests on WS_PATH. */
  handleUpgrade(req: IncomingMessage, socket: import('node:stream').Duplex, head: Buffer): void {
    const ip = this.clientIp(req);
    const origin = req.headers.origin;
    const { allowedOrigins } = this.deps.config;
    if (allowedOrigins.length && origin && !allowedOrigins.includes(origin)) {
      log.warn('WebSocket origin refused', { ip, origin });
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!this.connLimiter.take(ip)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  }

  /** Notify a TV that a remote uploaded a file. */
  notifyFileReceived(tvId: string, from: string, name: string, relPath: string, size: number): void {
    const tv = this.tvs.get(tvId);
    if (tv) this.send(tv, { t: 'tv.file.received', from, name, path: relPath, size });
  }

  isTvOnline(tvId: string): boolean {
    return this.tvs.has(tvId);
  }

  // -------------------------------------------------------------------------

  private clientIp(req: IncomingMessage): string {
    if (this.deps.config.trustProxy) {
      const fwd = req.headers['x-forwarded-for'];
      const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const fwdProto = this.deps.config.trustProxy ? req.headers['x-forwarded-proto'] : undefined;
    const conn: Conn = {
      ws,
      ip: this.clientIp(req),
      host: (this.deps.config.trustProxy && (req.headers['x-forwarded-host'] as string)) || req.headers.host,
      proto: (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto) ?? ('encrypted' in req.socket ? 'https' : 'http'),
      role: 'anon',
      lastSeen: this.now(),
      // Pointer moves are batched by remotes at ~60 Hz; leave generous headroom.
      bucket: new TokenBucket(400, 200, this.now),
      badFrames: 0,
      lastOfflineNotice: 0,
    };
    this.conns.add(conn);

    const authTimer = setTimeout(() => {
      if (conn.role === 'anon') ws.close(4001, 'auth timeout');
    }, AUTH_DEADLINE_MS);

    ws.on('pong', () => (conn.lastSeen = this.now()));
    ws.on('message', (data, isBinary) => {
      conn.lastSeen = this.now();
      if (isBinary) return this.badFrame(conn, 'binary frames are not supported');
      if (!conn.bucket.take()) {
        this.sendError(conn, 'rate_limited', 'Too many messages');
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        return this.badFrame(conn, 'invalid JSON');
      }
      const parsed = ClientMessageSchema.safeParse(raw);
      if (!parsed.success) {
        return this.badFrame(conn, parsed.error.issues[0]?.message ?? 'invalid message');
      }
      try {
        this.onMessage(conn, parsed.data);
      } catch (err) {
        log.error('Message handler failed', { error: String(err), type: parsed.data.t });
        this.sendError(conn, 'server_error', 'Internal error');
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      this.onClose(conn);
    });
    ws.on('error', (err) => log.debug('WebSocket error', { ip: conn.ip, error: String(err) }));
  }

  private badFrame(conn: Conn, message: string): void {
    conn.badFrames++;
    this.sendError(conn, 'bad_request', message);
    if (conn.badFrames > 20) conn.ws.close(4002, 'too many bad frames');
  }

  private onMessage(conn: Conn, msg: ClientMessage): void {
    if (msg.t === 'ping') {
      this.send(conn, { t: 'pong', ts: msg.ts, now: this.now() });
      return;
    }
    switch (conn.role) {
      case 'anon':
        return this.onAnon(conn, msg);
      case 'tv':
        return this.onTv(conn, msg);
      case 'remote':
        return this.onRemote(conn, msg);
      case 'pairing':
        // Waiting for the TV to decide; only pings are accepted.
        return this.sendError(conn, 'bad_request', 'Pairing in progress');
    }
  }

  // ---- Unauthenticated ----------------------------------------------------

  private onAnon(conn: Conn, msg: ClientMessage): void {
    if ('v' in msg && msg.v !== PROTOCOL_VERSION) {
      this.sendError(conn, 'bad_request', `Protocol version ${PROTOCOL_VERSION} required`);
      conn.ws.close(4003, 'protocol mismatch');
      return;
    }
    switch (msg.t) {
      case 'tv.hello':
        return this.tvHello(conn, msg);
      case 'remote.pair':
        return this.remotePair(conn, msg);
      case 'remote.resume':
        return this.remoteResume(conn, msg);
      default:
        this.sendError(conn, 'auth_invalid', 'Authenticate first');
    }
  }

  private tvHello(conn: Conn, msg: Extract<ClientMessage, { t: 'tv.hello' }>): void {
    const { store, signer } = this.deps;
    let tv = msg.deviceId && msg.secret ? store.authenticateTv(msg.deviceId, msg.secret) : null;
    let secret = msg.secret ?? '';
    if (!tv) {
      if (msg.deviceId) log.info('Unknown or invalid TV credentials, registering a new TV', { ip: conn.ip });
      if (!this.tvCreateLimiter.take(conn.ip)) {
        this.sendError(conn, 'rate_limited', 'Too many new TV registrations');
        conn.ws.close(4029, 'rate limited');
        return;
      }
      const created = store.createTv(msg.name.trim() || 'TV');
      tv = created.tv;
      secret = created.secret;
      log.info('Registered TV', { tvId: tv.id, ip: conn.ip });
    }

    const previous = this.tvs.get(tv.id);
    if (previous && previous !== conn) {
      this.sendError(previous, 'replaced', 'This TV was opened somewhere else');
      previous.role = 'anon';
      previous.ws.close(4004, 'replaced');
    }

    conn.role = 'tv';
    conn.tvId = tv.id;
    this.tvs.set(tv.id, conn);
    this.send(conn, {
      t: 'tv.welcome',
      deviceId: tv.id,
      secret,
      name: tv.name,
      settings: tv.settings,
      remotes: this.remoteList(tv.id),
      apiToken: signer.issueApiToken('tv', tv.id, tv.id),
    });
    this.scheduleApiRefresh(conn);
    this.broadcastToRemotes(tv.id, { t: 'remote.tv.status', online: true, tvName: tv.name });
    log.info('TV connected', { tvId: tv.id, ip: conn.ip });
  }

  private remotePair(conn: Conn, msg: Extract<ClientMessage, { t: 'remote.pair' }>): void {
    if (!this.pairLimiter.take(conn.ip)) {
      this.sendError(conn, 'rate_limited', 'Too many pairing attempts, wait a minute');
      return;
    }
    const result = this.pairing.consume({ token: msg.token, code: msg.code });
    if (!result.ok) {
      log.info('Pairing attempt failed', { ip: conn.ip, reason: result.reason });
      this.sendError(conn, result.reason, pairErrorText(result.reason));
      return;
    }
    const { store } = this.deps;
    const tv = store.getTv(result.tvId);
    const tvConn = this.tvs.get(result.tvId);
    // The ticket is burned; give the TV a fresh one for the next phone.
    if (tvConn) void this.pushPairCode(tvConn);
    if (!tv || !tvConn) {
      this.sendError(conn, 'tv_offline', 'The TV is not connected');
      return;
    }
    if (store.remoteCount(tv.id) >= tv.settings.maxRemotes) {
      this.sendError(conn, 'too_many_remotes', 'This TV already has the maximum number of paired remotes');
      return;
    }

    const needsConfirm = result.method === 'code' || tv.settings.requireConfirm;
    const name = msg.name.trim().slice(0, 64) || 'Remote';
    const platform = msg.platform.trim().slice(0, 64);
    if (!needsConfirm) {
      this.completePairing(conn, tv.id, name, platform);
      return;
    }
    const pending = this.pairing.createPending({
      tvId: tv.id,
      name,
      platform,
      ip: conn.ip,
      method: result.method,
    });
    if (!pending) {
      this.sendError(conn, 'rate_limited', 'Too many pairing requests waiting on this TV');
      return;
    }
    conn.role = 'pairing';
    conn.tvId = tv.id;
    conn.pendingRequestId = pending.requestId;
    this.send(conn, {
      t: 'remote.pending',
      requestId: pending.requestId,
      verifyCode: pending.verifyCode,
      tvName: tv.name,
      expiresAt: pending.expiresAt,
    });
    this.send(tvConn, { t: 'tv.pair.request', ...publicPending(pending) });
  }

  private completePairing(conn: Conn, tvId: string, name: string, platform: string): void {
    const { store, signer } = this.deps;
    const tv = store.getTv(tvId);
    const added = tv && store.remoteCount(tvId) < tv.settings.maxRemotes ? store.addRemote(tvId, name, platform) : null;
    if (!tv || !added) {
      this.sendError(conn, 'too_many_remotes', 'This TV already has the maximum number of paired remotes');
      conn.role = 'anon';
      return;
    }
    conn.role = 'remote';
    conn.tvId = tvId;
    conn.remoteId = added.remote.id;
    conn.pendingRequestId = undefined;
    this.addRemoteConn(conn);
    this.send(conn, { t: 'remote.paired', remoteId: added.remote.id, token: added.token, tvId, tvName: tv.name });
    this.send(conn, {
      t: 'remote.welcome',
      remoteId: added.remote.id,
      tvId,
      tvName: tv.name,
      tvOnline: this.tvs.has(tvId),
      apiToken: signer.issueApiToken('remote', added.remote.id, tvId),
    });
    this.sendCachedState(conn);
    this.scheduleApiRefresh(conn);
    this.pushRemoteList(tvId);
    log.info('Remote paired', { tvId, remoteId: added.remote.id, ip: conn.ip });
  }

  private remoteResume(conn: Conn, msg: Extract<ClientMessage, { t: 'remote.resume' }>): void {
    if (!this.pairLimiter.take(conn.ip, 0.25)) {
      this.sendError(conn, 'rate_limited', 'Too many attempts');
      return;
    }
    const found = this.deps.store.authenticateRemote(msg.remoteId, msg.token);
    if (!found) {
      this.sendError(conn, 'auth_invalid', 'This remote is no longer paired');
      return;
    }
    conn.role = 'remote';
    conn.tvId = found.tv.id;
    conn.remoteId = found.remote.id;
    this.addRemoteConn(conn);
    this.send(conn, {
      t: 'remote.welcome',
      remoteId: found.remote.id,
      tvId: found.tv.id,
      tvName: found.tv.name,
      tvOnline: this.tvs.has(found.tv.id),
      apiToken: this.deps.signer.issueApiToken('remote', found.remote.id, found.tv.id),
    });
    this.sendCachedState(conn);
    this.scheduleApiRefresh(conn);
    this.pushRemoteList(found.tv.id);
  }

  // ---- TV ---------------------------------------------------------------

  private onTv(conn: Conn, msg: ClientMessage): void {
    const tvId = conn.tvId!;
    const { store } = this.deps;
    switch (msg.t) {
      case 'tv.pair.create':
        void this.pushPairCode(conn);
        return;
      case 'tv.pair.decide': {
        const pending = this.pairing.getPending(msg.requestId);
        if (!pending || pending.tvId !== tvId) {
          this.send(conn, { t: 'tv.pair.resolved', requestId: msg.requestId, approved: false, reason: 'expired' });
          return;
        }
        this.pairing.takePending(msg.requestId);
        const remoteConn = this.findPairingConn(msg.requestId);
        if (!remoteConn) {
          this.send(conn, { t: 'tv.pair.resolved', requestId: msg.requestId, approved: false, reason: 'gone' });
          return;
        }
        if (msg.approve) {
          this.completePairing(remoteConn, tvId, pending.name, pending.platform);
        } else {
          remoteConn.role = 'anon';
          remoteConn.pendingRequestId = undefined;
          this.sendError(remoteConn, 'pair_rejected', 'The TV declined the pairing request');
        }
        this.send(conn, { t: 'tv.pair.resolved', requestId: msg.requestId, approved: msg.approve });
        return;
      }
      case 'tv.remote.revoke':
        this.revokeRemote(tvId, msg.remoteId, 'Removed from the TV');
        return;
      case 'tv.settings': {
        const tv = store.updateTv(tvId, { settings: msg.settings });
        if (tv) this.send(conn, { t: 'tv.settings', settings: tv.settings });
        return;
      }
      case 'tv.rename': {
        const tv = store.updateTv(tvId, { name: msg.name.trim().slice(0, 64) });
        if (tv) this.broadcastToRemotes(tvId, { t: 'remote.tv.status', online: true, tvName: tv.name });
        return;
      }
      case 'tv.state':
        this.lastState.set(tvId, msg.state);
        this.broadcastToRemotes(tvId, { t: 'remote.tv.state', state: msg.state });
        return;
      case 'tv.event': {
        const out: ServerMessage = { t: 'remote.tv.event', event: msg.event };
        if (msg.to) {
          for (const r of this.remotes.get(tvId) ?? []) if (r.remoteId === msg.to) this.send(r, out);
        } else {
          this.broadcastToRemotes(tvId, out);
        }
        return;
      }
      default:
        this.sendError(conn, 'bad_request', `Message ${msg.t} is not valid for a TV`);
    }
  }

  private async pushPairCode(conn: Conn): Promise<void> {
    const tvId = conn.tvId;
    if (!tvId) return;
    const ticket = this.pairing.issue(tvId);
    const base = resolvePublicBase({
      publicUrl: this.deps.config.publicUrl,
      port: this.deps.config.port,
      requestHost: conn.host,
      requestProto: conn.proto,
    });
    const url = `${base}/remote#pair=${encodeURIComponent(ticket.token)}`;
    let qrSvg = '';
    try {
      qrSvg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
    } catch (err) {
      log.error('QR generation failed', { error: String(err) });
    }
    // The ticket may have been replaced while the QR was rendering.
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    this.send(conn, {
      t: 'tv.pair.code',
      token: ticket.token,
      code: ticket.code,
      url,
      baseUrl: `${base}/remote`,
      qrSvg,
      expiresAt: ticket.expiresAt,
    });
  }

  // ---- Remote -----------------------------------------------------------

  private onRemote(conn: Conn, msg: ClientMessage): void {
    const tvId = conn.tvId!;
    switch (msg.t) {
      case 'input':
      case 'inputs': {
        const events: InputEvent[] = msg.t === 'input' ? [msg.e] : msg.e;
        if (!events.length) return;
        const tv = this.tvs.get(tvId);
        if (!tv) {
          if (this.now() - conn.lastOfflineNotice > 3_000) {
            conn.lastOfflineNotice = this.now();
            this.sendError(conn, 'tv_offline', 'The TV is not connected');
          }
          return;
        }
        this.send(tv, { t: 'tv.input', from: conn.remoteId!, e: events });
        return;
      }
      case 'remote.unpair':
        this.revokeRemote(tvId, conn.remoteId!, 'Unpaired from this phone');
        return;
      default:
        this.sendError(conn, 'bad_request', `Message ${msg.t} is not valid for a remote`);
    }
  }

  private revokeRemote(tvId: string, remoteId: string, reason: string): void {
    this.deps.store.removeRemote(tvId, remoteId);
    for (const r of [...(this.remotes.get(tvId) ?? [])]) {
      if (r.remoteId !== remoteId) continue;
      this.send(r, { t: 'remote.revoked', reason });
      r.role = 'anon';
      this.remotes.get(tvId)?.delete(r);
      r.ws.close(4005, 'revoked');
    }
    this.pushRemoteList(tvId);
    log.info('Remote revoked', { tvId, remoteId });
  }

  // ---- Helpers ------------------------------------------------------------

  private addRemoteConn(conn: Conn): void {
    let set = this.remotes.get(conn.tvId!);
    if (!set) this.remotes.set(conn.tvId!, (set = new Set()));
    set.add(conn);
  }

  private sendCachedState(conn: Conn): void {
    const state = this.lastState.get(conn.tvId!);
    if (state && this.tvs.has(conn.tvId!)) this.send(conn, { t: 'remote.tv.state', state });
  }

  private findPairingConn(requestId: string): Conn | undefined {
    for (const c of this.conns) if (c.role === 'pairing' && c.pendingRequestId === requestId) return c;
    return undefined;
  }

  private remoteList(tvId: string) {
    const online = new Set([...(this.remotes.get(tvId) ?? [])].map((c) => c.remoteId));
    return this.deps.store.listRemotes(tvId, (id) => online.has(id));
  }

  private pushRemoteList(tvId: string): void {
    const tv = this.tvs.get(tvId);
    if (tv) this.send(tv, { t: 'tv.remotes', remotes: this.remoteList(tvId) });
  }

  private broadcastToRemotes(tvId: string, msg: ServerMessage): void {
    const set = this.remotes.get(tvId);
    if (!set) return;
    const frame = JSON.stringify(msg);
    for (const c of set) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(frame);
  }

  private scheduleApiRefresh(conn: Conn): void {
    if (conn.apiTimer) clearInterval(conn.apiTimer);
    conn.apiTimer = setInterval(() => {
      if (conn.role === 'tv') {
        this.send(conn, { t: 'api.token', apiToken: this.deps.signer.issueApiToken('tv', conn.tvId!, conn.tvId!) });
      } else if (conn.role === 'remote') {
        this.send(conn, {
          t: 'api.token',
          apiToken: this.deps.signer.issueApiToken('remote', conn.remoteId!, conn.tvId!),
        });
      }
    }, API_TOKEN_TTL_MS / 2);
    conn.apiTimer.unref?.();
  }

  private onClose(conn: Conn): void {
    this.conns.delete(conn);
    if (conn.apiTimer) clearInterval(conn.apiTimer);
    if (conn.tvId && this.tvs.get(conn.tvId) === conn) {
      this.tvs.delete(conn.tvId);
      this.pairing.revokeTicket(conn.tvId);
      const tv = this.deps.store.getTv(conn.tvId);
      this.broadcastToRemotes(conn.tvId, { t: 'remote.tv.status', online: false, tvName: tv?.name ?? 'TV' });
      log.info('TV disconnected', { tvId: conn.tvId });
    }
    if (conn.tvId && conn.remoteId) {
      const set = this.remotes.get(conn.tvId);
      if (set?.delete(conn)) {
        this.deps.store.touchRemote(conn.tvId, conn.remoteId);
        this.pushRemoteList(conn.tvId);
      }
    }
    if (conn.pendingRequestId) {
      const pending = this.pairing.takePending(conn.pendingRequestId);
      const tv = pending && this.tvs.get(pending.tvId);
      if (tv) this.send(tv, { t: 'tv.pair.resolved', requestId: pending.requestId, approved: false, reason: 'gone' });
    }
  }

  private tick(): void {
    const t = this.now();
    for (const c of this.conns) {
      if (t - c.lastSeen > HEARTBEAT_TIMEOUT_MS) {
        c.ws.terminate();
      } else if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.ping();
      }
    }
    for (const p of this.pairing.expirePending()) this.expirePending(p);
    for (const tvId of this.pairing.expireTickets()) {
      const tv = this.tvs.get(tvId);
      if (tv) void this.pushPairCode(tv);
    }
    this.connLimiter.sweep();
    this.pairLimiter.sweep();
  }

  private expirePending(p: PendingRequest): void {
    const remote = this.findPairingConn(p.requestId);
    if (remote) {
      remote.role = 'anon';
      remote.pendingRequestId = undefined;
      this.sendError(remote, 'pair_timeout', 'The TV did not respond in time');
    }
    const tv = this.tvs.get(p.tvId);
    if (tv) this.send(tv, { t: 'tv.pair.resolved', requestId: p.requestId, approved: false, reason: 'timeout' });
  }

  private send(conn: Conn, msg: ServerMessage): void {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  private sendError(conn: Conn, code: ErrorCode, message: string): void {
    this.send(conn, { t: 'error', code, message });
  }
}

function publicPending(p: PendingRequest) {
  return {
    requestId: p.requestId,
    name: p.name,
    platform: p.platform,
    ip: p.ip,
    verifyCode: p.verifyCode,
    method: p.method,
    expiresAt: p.expiresAt,
  };
}

function pairErrorText(reason: 'pair_invalid' | 'pair_expired' | 'rate_limited'): string {
  switch (reason) {
    case 'pair_expired':
      return 'The pairing code has expired. Scan the new QR code on the TV.';
    case 'rate_limited':
      return 'Code pairing is temporarily disabled because of too many failed attempts.';
    default:
      return 'Invalid pairing code';
  }
}
