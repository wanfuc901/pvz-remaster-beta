type Level = 'debug' | 'info' | 'warn' | 'error';
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = order.info;

export function setLogLevel(level: Level): void {
  threshold = order[level];
}

function emit(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (order[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  const suffix = extra && Object.keys(extra).length ? ' ' + JSON.stringify(extra) : '';
  (level === 'error' || level === 'warn' ? console.error : console.log)(line + suffix);
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => emit('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit('error', msg, extra),
};
