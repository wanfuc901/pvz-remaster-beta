import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, type ServerMessage } from '@tvwebos/shared';
import type { Config } from './config.js';
import { startServer, type RunningServer } from './server.js';

let running: RunningServer;
let tmp: string;
let base: string;

function makeConfig(dir: string): Config {
  return {
    host: '127.0.0.1',
    port: 0,
    publicUrl: 'http://tv.test:8686',
    dataDir: path.join(dir, 'data'),
    mediaDir: path.join(dir, 'media'),
    clientDir: path.join(dir, 'client'),
    catalogDir: path.join(dir, 'catalog'),
    maxUploadBytes: 1024 * 1024,
    filesReadonly: false,
    remoteIdleDays: 30,
    trustProxy: false,
    allowedOrigins: [],
    pairAttemptsPerMinute: 1000,
    logLevel: 'error',
  };
}

/** Small WebSocket client that queues incoming messages for `next()`. */
class Client {
  ws: WebSocket;
  private queue: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }> = [];
  closed = new Promise<number>((resolve) => this.ws?.once('close', resolve));

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.closed = new Promise<number>((resolve) => this.ws.once('close', (code) => resolve(code)));
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      const i = this.waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.queue.push(msg);
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  next<T extends ServerMessage['t']>(t: T, timeout = 2000): Promise<Extract<ServerMessage, { t: T }>> {
    const pred = (m: ServerMessage) => m.t === t;
    const i = this.queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0] as Extract<ServerMessage, { t: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeout);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}

async function connect(): Promise<Client> {
  const c = new Client(`${base.replace('http', 'ws')}/ws`);
  await c.open();
  return c;
}

async function connectTv(creds?: { deviceId: string; secret: string }) {
  const tv = await connect();
  tv.send({ t: 'tv.hello', v: PROTOCOL_VERSION, name: 'Living room', ...creds });
  const welcome = await tv.next('tv.welcome');
  return { tv, welcome };
}

async function pairRemote(tv: Client, opts: { approve?: boolean } = {}) {
  tv.send({ t: 'tv.pair.create' });
  const code = await tv.next('tv.pair.code');
  const remote = await connect();
  remote.send({ t: 'remote.pair', v: PROTOCOL_VERSION, token: code.token, name: 'Phone', platform: 'test' });
  const pending = await remote.next('remote.pending');
  const request = await tv.next('tv.pair.request');
  expect(request.verifyCode).toBe(pending.verifyCode);
  tv.send({ t: 'tv.pair.decide', requestId: request.requestId, approve: opts.approve ?? true });
  return { remote, code };
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tvwebos-test-'));
  fs.mkdirSync(path.join(tmp, 'media'), { recursive: true });
  running = await startServer(makeConfig(tmp));
  base = `http://127.0.0.1:${running.port}`;
});

afterAll(async () => {
  await running.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('pairing', () => {
  it('registers a TV and restores it with the same credentials', async () => {
    const first = await connectTv();
    expect(first.welcome.deviceId).toMatch(/^[0-9a-f]{32}$/);
    first.tv.close();
    await first.tv.closed;
    const again = await connectTv({ deviceId: first.welcome.deviceId, secret: first.welcome.secret });
    expect(again.welcome.deviceId).toBe(first.welcome.deviceId);
    again.tv.close();
  });

  it('issues a QR URL that carries the token in the fragment', async () => {
    const { tv } = await connectTv();
    tv.send({ t: 'tv.pair.create' });
    const code = await tv.next('tv.pair.code');
    expect(code.url).toBe(`http://tv.test:8686/remote#pair=${encodeURIComponent(code.token)}`);
    expect(code.code).toMatch(/^\d{6}$/);
    expect(code.qrSvg).toContain('<svg');
    tv.close();
  });

  it('pairs after confirmation, relays input and resumes with the remote token', async () => {
    const { tv, welcome } = await connectTv();
    const { remote } = await pairRemote(tv);
    const paired = await remote.next('remote.paired');
    const rWelcome = await remote.next('remote.welcome');
    expect(rWelcome.tvOnline).toBe(true);
    expect((await tv.next('tv.pair.resolved')).approved).toBe(true);

    remote.send({ t: 'input', e: { k: 'move', dx: 5, dy: -3 } });
    const input = await tv.next('tv.input');
    expect(input.e).toEqual([{ k: 'move', dx: 5, dy: -3 }]);
    expect(input.from).toBe(paired.remoteId);

    tv.send({
      t: 'tv.state',
      state: { windows: [], apps: [], text: null, media: null, overlay: 'none', gamepadApp: false },
    });
    expect((await remote.next('remote.tv.state')).state.overlay).toBe('none');
    remote.close();
    await remote.closed;

    const again = await connect();
    again.send({ t: 'remote.resume', v: PROTOCOL_VERSION, remoteId: paired.remoteId, token: paired.token });
    const w2 = await again.next('remote.welcome');
    expect(w2.tvId).toBe(welcome.deviceId);
    // The cached TV state is replayed to a reconnecting remote.
    expect((await again.next('remote.tv.state')).state.overlay).toBe('none');
    again.close();
    tv.close();
  });

  it('rejects a reused QR token', async () => {
    const { tv } = await connectTv();
    const { remote, code } = await pairRemote(tv);
    await remote.next('remote.paired');
    const intruder = await connect();
    intruder.send({ t: 'remote.pair', v: PROTOCOL_VERSION, token: code.token, name: 'X', platform: 'x' });
    const err = await intruder.next('error');
    expect(err.code).toBe('pair_invalid');
    intruder.close();
    remote.close();
    tv.close();
  });

  it('tells the phone when the TV declines', async () => {
    const { tv } = await connectTv();
    const { remote } = await pairRemote(tv, { approve: false });
    expect((await remote.next('error')).code).toBe('pair_rejected');
    remote.close();
    tv.close();
  });

  it('pairs by 6-digit code and always asks the TV', async () => {
    const { tv } = await connectTv();
    tv.send({ t: 'tv.settings', settings: { requireConfirm: false } });
    await tv.next('tv.settings');
    tv.send({ t: 'tv.pair.create' });
    const code = await tv.next('tv.pair.code');
    const remote = await connect();
    remote.send({ t: 'remote.pair', v: PROTOCOL_VERSION, code: code.code, name: 'Phone', platform: 't' });
    await remote.next('remote.pending');
    const req = await tv.next('tv.pair.request');
    expect(req.method).toBe('code');
    tv.send({ t: 'tv.pair.decide', requestId: req.requestId, approve: true });
    await remote.next('remote.paired');
    remote.close();
    tv.close();
  });

  it('revoking a remote disconnects it and invalidates its token', async () => {
    const { tv } = await connectTv();
    const { remote } = await pairRemote(tv);
    const paired = await remote.next('remote.paired');
    tv.send({ t: 'tv.remote.revoke', remoteId: paired.remoteId });
    expect((await remote.next('remote.revoked')).t).toBe('remote.revoked');
    expect(await remote.closed).toBe(4005);
    const again = await connect();
    again.send({ t: 'remote.resume', v: PROTOCOL_VERSION, remoteId: paired.remoteId, token: paired.token });
    expect((await again.next('error')).code).toBe('auth_invalid');
    again.close();
    tv.close();
  });

  it('refuses input from unauthenticated sockets and bad frames', async () => {
    const c = await connect();
    c.send({ t: 'input', e: { k: 'move', dx: 1, dy: 1 } });
    expect((await c.next('error')).code).toBe('auth_invalid');
    c.send({ t: 'nope' });
    expect((await c.next('error')).code).toBe('bad_request');
    c.close();
  });
});

describe('files API', () => {
  it('requires auth, lists, uploads and streams with signed URLs', async () => {
    const { tv, welcome } = await connectTv();
    const auth = { Authorization: `Bearer ${welcome.apiToken}` };

    expect((await fetch(`${base}/api/files/list`)).status).toBe(401);

    const up = await fetch(`${base}/api/files/upload?name=${encodeURIComponent('../../evil.txt')}`, {
      method: 'PUT',
      headers: auth,
      body: 'hello',
    });
    expect(up.status).toBe(200);
    const upBody = (await up.json()) as { path: string };
    expect(upBody.path).toBe('Uploads/evil.txt');
    await tv.next('tv.file.received');

    const list = (await (await fetch(`${base}/api/files/list?path=Uploads`, { headers: auth })).json()) as {
      entries: Array<{ name: string; url: string }>;
    };
    const file = list.entries.find((e) => e.name === 'evil.txt')!;
    expect(file).toBeTruthy();
    const raw = await fetch(base + file.url);
    expect(await raw.text()).toBe('hello');
    expect((await fetch(base + file.url.replace(/sig=[^&]+/, 'sig=bad'))).status).toBe(403);

    const traversal = await fetch(`${base}/api/files/list?path=${encodeURIComponent('../')}`, { headers: auth });
    expect(traversal.status).toBe(400);
    tv.close();
  });
});
