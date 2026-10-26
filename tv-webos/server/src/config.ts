import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Root of the tv-webos project (server/src or server/dist -> ../..). */
export const PROJECT_ROOT = path.resolve(here, '..', '..');

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Environment variable ${name} must be an integer in [${min}, ${max}], got "${raw}"`);
  }
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (/^(1|true|yes|on)$/i.test(raw)) return true;
  if (/^(0|false|no|off)$/i.test(raw)) return false;
  throw new Error(`Environment variable ${name} must be a boolean, got "${raw}"`);
}

function list(name: string): string[] {
  return str(name, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface Config {
  host: string;
  port: number;
  /** Public base URL (e.g. https://tv.example.com). When empty the LAN address is detected. */
  publicUrl: string;
  dataDir: string;
  mediaDir: string;
  clientDir: string;
  catalogDir: string;
  maxUploadBytes: number;
  filesReadonly: boolean;
  /** Days a paired remote stays valid without being used. */
  remoteIdleDays: number;
  /** Honour X-Forwarded-For (only behind a trusted reverse proxy). */
  trustProxy: boolean;
  /** If non-empty, WebSocket upgrades from other Origins are refused. */
  allowedOrigins: string[];
  /** Pairing attempts allowed per client IP per minute. */
  pairAttemptsPerMinute: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(): Config {
  const logLevel = str('LOG_LEVEL', 'info');
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`LOG_LEVEL must be one of debug|info|warn|error, got "${logLevel}"`);
  }
  const publicUrl = str('PUBLIC_URL', '').replace(/\/+$/, '');
  if (publicUrl && !/^https?:\/\/[^/]+(\/.*)?$/i.test(publicUrl)) {
    throw new Error(`PUBLIC_URL must be an absolute http(s) URL, got "${publicUrl}"`);
  }
  return {
    host: str('HOST', '0.0.0.0'),
    port: int('PORT', 8686, 1, 65535),
    publicUrl,
    dataDir: path.resolve(str('DATA_DIR', path.join(PROJECT_ROOT, 'data'))),
    mediaDir: path.resolve(str('MEDIA_DIR', path.join(PROJECT_ROOT, 'media'))),
    clientDir: path.resolve(str('CLIENT_DIR', path.join(PROJECT_ROOT, 'client', 'dist'))),
    catalogDir: path.resolve(str('CATALOG_DIR', path.join(PROJECT_ROOT, 'server', 'catalog'))),
    maxUploadBytes: int('MAX_UPLOAD_MB', 4096, 1, 1024 * 1024) * 1024 * 1024,
    filesReadonly: bool('FILES_READONLY', false),
    remoteIdleDays: int('REMOTE_IDLE_DAYS', 30, 1, 3650),
    trustProxy: bool('TRUST_PROXY', false),
    allowedOrigins: list('ALLOWED_ORIGINS'),
    pairAttemptsPerMinute: int('PAIR_ATTEMPTS_PER_MIN', 6, 1, 10_000),
    logLevel: logLevel as Config['logLevel'],
  };
}
