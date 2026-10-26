/**
 * WebSocket with automatic reconnection and application-level heartbeat.
 *
 * - Exponential backoff with jitter (0.5 s .. 15 s), reset after a stable connection.
 * - Pings every HEARTBEAT_INTERVAL_MS; if nothing is received for
 *   HEARTBEAT_TIMEOUT_MS the socket is considered dead and replaced. This catches
 *   half-open connections (Wi-Fi drop, TV standby) that never fire `close`.
 * - Reconnects immediately when the browser reports it is back online or the
 *   page becomes visible again.
 */
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from '@tvwebos/shared/constants';
import type { ClientMessage, ServerMessage } from '@tvwebos/shared';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface SocketOptions {
  url: string;
  onOpen: (socket: ReconnectingSocket) => void;
  onMessage: (msg: ServerMessage) => void;
  onStatus?: (status: SocketStatus, info: { attempt: number; retryInMs: number; latencyMs: number | null }) => void;
  /** Close codes after which we must not reconnect automatically. */
  fatalCodes?: number[];
  onFatal?: (code: number, reason: string) => void;
}

const MIN_DELAY = 500;
const MAX_DELAY = 15_000;

export class ReconnectingSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: number | null = null;
  private pingTimer: number | null = null;
  private lastHeard = 0;
  private openedAt = 0;
  private stopped = false;
  private latency: number | null = null;
  status: SocketStatus = 'closed';

  constructor(private readonly opts: SocketOptions) {
    window.addEventListener('online', this.kick);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  get latencyMs(): number | null {
    return this.latency;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    window.removeEventListener('online', this.kick);
    document.removeEventListener('visibilitychange', this.onVisible);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000, 'stopped');
      this.ws = null;
    }
    this.setStatus('closed', 0);
  }

  /** Send if connected. Returns false when the message was dropped. */
  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Drop the current connection and reconnect now. */
  reconnect(): void {
    if (this.stopped) return;
    this.attempt = 0;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.clearTimers();
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    this.setStatus('connecting', 0);
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.openedAt = Date.now();
      this.lastHeard = Date.now();
      this.setStatus('open', 0);
      this.startHeartbeat();
      this.opts.onOpen(this);
    };
    ws.onmessage = (ev) => {
      this.lastHeard = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        this.latency = Date.now() - msg.ts;
        // Re-emit status so the UI can show the latency.
        if (this.status === 'open') this.setStatus('open', 0);
        return;
      }
      this.opts.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (this.opts.fatalCodes?.includes(ev.code)) {
        this.stopped = true;
        this.setStatus('closed', 0);
        this.opts.onFatal?.(ev.code, ev.reason);
        return;
      }
      // A connection that stayed up for a while resets the backoff.
      if (this.openedAt && Date.now() - this.openedAt > 10_000) this.attempt = 0;
      this.openedAt = 0;
      this.scheduleRetry();
    };
    ws.onerror = () => {
      // `close` follows; nothing to do here.
    };
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    const base = Math.min(MAX_DELAY, MIN_DELAY * Math.pow(2, this.attempt));
    const delay = Math.round(base / 2 + Math.random() * (base / 2));
    this.attempt++;
    this.setStatus('closed', delay);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.pingTimer = window.setInterval(() => {
      if (Date.now() - this.lastHeard > HEARTBEAT_TIMEOUT_MS) {
        this.reconnect();
        return;
      }
      this.send({ t: 'ping', ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
    this.send({ t: 'ping', ts: Date.now() });
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private setStatus(status: SocketStatus, retryInMs: number): void {
    this.status = status;
    this.opts.onStatus?.(status, { attempt: this.attempt, retryInMs, latencyMs: this.latency });
  }

  private readonly kick = () => {
    if (this.status !== 'open') this.reconnect();
  };

  private readonly onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (this.status !== 'open') this.reconnect();
    else if (Date.now() - this.lastHeard > HEARTBEAT_INTERVAL_MS) this.send({ t: 'ping', ts: Date.now() });
  };
}
