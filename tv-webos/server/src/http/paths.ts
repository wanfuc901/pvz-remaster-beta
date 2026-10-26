import fs from 'node:fs';
import path from 'node:path';

export class PathError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Normalise a client-supplied relative path ("Movies/a.mp4", "/", "") into a
 * POSIX path without leading slash. Rejects traversal and odd characters.
 */
export function normalizeRel(input: unknown): string {
  if (input === undefined || input === null || input === '') return '';
  if (typeof input !== 'string' || input.length > 1024) throw new PathError('Invalid path');
  if (/[\0\\]/.test(input)) throw new PathError('Invalid path');
  const parts = input.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) throw new PathError('Invalid path');
  return parts.join('/');
}

/**
 * Resolve a relative path inside `root`, following symlinks, and make sure
 * the result is still inside `root`. For paths that do not exist yet
 * (`mustExist: false`) the parent directory is checked instead.
 */
export function resolveInside(root: string, rel: string, mustExist = true): string {
  const realRoot = fs.realpathSync(root);
  const abs = path.resolve(realRoot, rel);
  let real: string;
  try {
    real = fs.realpathSync(abs);
  } catch {
    if (mustExist) throw new PathError('Not found', 404);
    real = path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new PathError('Invalid path');
  return real;
}

/** Turn an uploaded file name into a safe single path segment. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'file';
}

/** "name.ext" -> "name (1).ext" until the path is free. */
export function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(dir, name);
  for (let i = 1; fs.existsSync(candidate); i++) candidate = path.join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

const KINDS: Record<string, 'video' | 'audio' | 'image' | 'text'> = {};
for (const e of ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ts', 'm2ts', 'avi', 'mpg', 'mpeg', '3gp']) KINDS[e] = 'video';
for (const e of ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma']) KINDS[e] = 'audio';
for (const e of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic']) KINDS[e] = 'image';
for (const e of ['txt', 'md', 'json', 'log', 'csv', 'srt', 'vtt', 'xml', 'yml', 'yaml', 'ini']) KINDS[e] = 'text';

export type FileKind = 'video' | 'audio' | 'image' | 'text' | 'other';

export function fileKind(name: string): FileKind {
  return KINDS[path.extname(name).slice(1).toLowerCase()] ?? 'other';
}
