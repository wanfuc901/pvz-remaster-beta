/**
 * File access for built-in apps: the server media library (HTTP API) and
 * TV-local files kept in IndexedDB.
 */
import { idb } from '../../common/idb';
import { uid } from '../../common/format';
import { absUrl, api, postJson } from './api';

export type FileKind = 'video' | 'audio' | 'image' | 'text' | 'other' | 'dir';

export interface ServerEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  kind: FileKind;
  size: number;
  mtime: number;
  url?: string;
}

export interface LocalFile {
  id: string;
  name: string;
  type: string;
  size: number;
  mtime: number;
  blob: Blob;
}

const EXT_KIND: Record<string, FileKind> = {};
for (const e of ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ts', 'm2ts', 'avi', 'mpg', 'mpeg', '3gp']) EXT_KIND[e] = 'video';
for (const e of ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'wma']) EXT_KIND[e] = 'audio';
for (const e of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic']) EXT_KIND[e] = 'image';
for (const e of ['txt', 'md', 'json', 'log', 'csv', 'srt', 'vtt', 'xml', 'yml', 'yaml', 'ini']) EXT_KIND[e] = 'text';

export function kindOf(name: string): FileKind {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXT_KIND[ext] ?? 'other';
}

// ---- Server ---------------------------------------------------------------

export async function listServer(path: string): Promise<{ path: string; readonly: boolean; entries: ServerEntry[] }> {
  const res = await api<{ path: string; readonly: boolean; entries: ServerEntry[] }>(`/api/files/list?path=${encodeURIComponent(path)}`);
  return { ...res, entries: res.entries.map((e) => ({ ...e, url: e.url ? absUrl(e.url) : undefined })) };
}

export async function indexServer(kind: 'image' | 'video' | 'audio'): Promise<ServerEntry[]> {
  const res = await api<{ entries: ServerEntry[] }>(`/api/files/index?kind=${kind}`);
  return res.entries.map((e) => ({ ...e, url: e.url ? absUrl(e.url) : undefined }));
}

/** Find one server file (and its siblings) by path. */
export async function serverFileWithSiblings(path: string): Promise<{ file: ServerEntry | null; siblings: ServerEntry[] }> {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const { entries } = await listServer(dir);
  return { file: entries.find((e) => e.path === path) ?? null, siblings: entries.filter((e) => e.type === 'file') };
}

export const serverOps = {
  mkdir: (path: string) => postJson('/api/files/mkdir', { path }),
  rename: (path: string, name: string) => postJson<{ path: string }>('/api/files/rename', { path, name }),
  remove: (path: string) => postJson('/api/files/delete', { path }),
};

// ---- Local (IndexedDB) ------------------------------------------------------

export async function listLocal(): Promise<LocalFile[]> {
  const files = await idb.getAll<LocalFile>('files');
  return files.sort((a, b) => b.mtime - a.mtime);
}

export async function getLocal(id: string): Promise<LocalFile | undefined> {
  return idb.get<LocalFile>('files', id);
}

export async function saveLocal(name: string, blob: Blob): Promise<LocalFile> {
  const file: LocalFile = { id: uid(), name, type: blob.type, size: blob.size, mtime: Date.now(), blob };
  await idb.put('files', file);
  return file;
}

export async function renameLocal(id: string, name: string): Promise<void> {
  const f = await getLocal(id);
  if (!f) throw new Error('Không tìm thấy tệp');
  await idb.put('files', { ...f, name, mtime: Date.now() });
}

export async function deleteLocal(id: string): Promise<void> {
  await idb.delete('files', id);
}

/** Download a server file into TV storage. */
export async function copyToLocal(entry: ServerEntry): Promise<LocalFile> {
  if (!entry.url) throw new Error('Không có liên kết tải');
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`Tải thất bại (HTTP ${res.status})`);
  return saveLocal(entry.name, await res.blob());
}

/** Object URLs for local blobs, released when no longer needed. */
export function localObjectUrl(file: LocalFile): { url: string; release: () => void } {
  const url = URL.createObjectURL(file.blob);
  return { url, release: () => URL.revokeObjectURL(url) };
}
