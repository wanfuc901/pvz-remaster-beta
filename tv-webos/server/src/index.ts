import { loadConfig } from './config.js';
import { log, setLogLevel } from './core/log.js';
import { lanAddresses } from './core/network.js';
import { startServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  const running = await startServer(config);

  const urls = config.publicUrl
    ? [config.publicUrl]
    : ['127.0.0.1', ...lanAddresses()].map((ip) => `http://${ip}:${running.port}`);
  log.info(`TV WebOS server listening on ${config.host}:${running.port}`);
  for (const url of urls) log.info(`  TV desktop:  ${url}/`);
  log.info(`  Media dir:   ${config.mediaDir}${config.filesReadonly ? ' (read-only)' : ''}`);
  log.info(`  Data dir:    ${config.dataDir}`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`Received ${signal}, shutting down`);
    const force = setTimeout(() => process.exit(1), 5_000);
    force.unref();
    await running.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('Failed to start', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
