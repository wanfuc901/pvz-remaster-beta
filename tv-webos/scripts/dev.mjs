// Development: builds the shared package, then runs the API/WebSocket server
// (port 8686, auto-restart) and the Vite dev server (port 5173, hot reload)
// side by side. Open http://<this-computer-LAN-IP>:5173/ on the TV.
import { spawn, spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const shared = spawnSync(npm, ['run', 'build', '-w', 'shared'], { stdio: 'inherit' });
if (shared.status !== 0) process.exit(shared.status ?? 1);

const children = [
  spawn(npm, ['run', 'dev', '-w', 'server'], { stdio: 'inherit', env: { ...process.env, PUBLIC_URL: process.env.PUBLIC_URL ?? '' } }),
  spawn(npm, ['run', 'dev', '-w', 'client'], { stdio: 'inherit' }),
];

const stop = () => {
  for (const c of children) c.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => code && code !== 0 && stop());
