import http from 'node:http';
import { WS_PATH } from '@tvwebos/shared';
import type { Config } from './config.js';
import { DeviceStore } from './core/store.js';
import { TokenSigner } from './core/tokens.js';
import { createApp } from './http/app.js';
import { Hub } from './ws/hub.js';

export interface RunningServer {
  server: http.Server;
  hub: Hub;
  store: DeviceStore;
  port: number;
  close(): Promise<void>;
}

/** Wire store, HTTP app and WebSocket hub together and start listening. */
export async function startServer(config: Config): Promise<RunningServer> {
  const store = new DeviceStore(config.dataDir, config.remoteIdleDays);
  store.load();
  const signer = new TokenSigner(store.loadServerSecret());

  let hub: Hub | null = null;
  const app = createApp({
    config,
    store,
    signer,
    onUpload: (tvId, from, name, relPath, size) => hub?.notifyFileReceived(tvId, from, name, relPath, size),
  });
  hub = new Hub({ config, store, signer });
  hub.start();

  const server = http.createServer(app);
  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname === WS_PATH) hub!.handleUpgrade(req, socket, head);
    else socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.port;

  return {
    server,
    hub,
    store,
    port,
    async close() {
      hub!.stop();
      store.flush();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
