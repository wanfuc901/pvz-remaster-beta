/** HTTP API client for the TV (bearer token from the WebSocket welcome). */
import { serverUrl } from '../../common/server';
import { os } from './store';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function apiBase(): string {
  const base = os.get().link.serverBase;
  if (!base) throw new ApiError('Chưa cấu hình server', 0);
  return base;
}

/** Absolute URL for a server-relative path (signed media URLs, catalog files). */
export function absUrl(path: string): string {
  return serverUrl(apiBase(), path);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = os.get().link.apiToken;
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(absUrl(path), { ...init, headers });
  } catch {
    throw new ApiError('Không kết nối được tới server', 0);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `Lỗi ${res.status}`;
    throw new ApiError(res.status === 401 ? 'Phiên đã hết hạn, đang kết nối lại' : msg, res.status);
  }
  return body as T;
}

export function postJson<T>(path: string, data: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: JSON.stringify(data) });
}
