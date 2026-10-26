/**
 * Stateless signed tokens for the HTTP API and media URLs.
 *
 * API token:   "<role>.<subject>.<tvId>.<exp>.<sig>"  (sent as Authorization: Bearer)
 * Media URL:   /api/files/raw?path=...&exp=...&sig=... (for <video>/<img>, which cannot send headers)
 *
 * The token only proves who the bearer was when it was issued; callers must
 * still check that the TV / remote has not been revoked since.
 */
import { hmac, safeEqual } from './crypto.js';

export type ApiRole = 'tv' | 'remote';

export interface ApiPrincipal {
  role: ApiRole;
  /** TV id for role "tv", remote id for role "remote". */
  subject: string;
  tvId: string;
  exp: number;
}

export const API_TOKEN_TTL_MS = 12 * 3600 * 1000;
export const MEDIA_URL_TTL_MS = 12 * 3600 * 1000;

export class TokenSigner {
  constructor(
    private readonly secret: Buffer,
    private readonly now: () => number = Date.now,
  ) {}

  issueApiToken(role: ApiRole, subject: string, tvId: string, ttlMs = API_TOKEN_TTL_MS): string {
    const exp = this.now() + ttlMs;
    const body = `${role}.${subject}.${tvId}.${exp}`;
    return `${body}.${hmac(this.secret, 'api:' + body)}`;
  }

  verifyApiToken(token: string): ApiPrincipal | null {
    const parts = token.split('.');
    if (parts.length !== 5) return null;
    const [role, subject, tvId, expRaw, sig] = parts;
    if (role !== 'tv' && role !== 'remote') return null;
    const body = `${role}.${subject}.${tvId}.${expRaw}`;
    if (!safeEqual(sig, hmac(this.secret, 'api:' + body))) return null;
    const exp = Number(expRaw);
    if (!Number.isFinite(exp) || exp <= this.now()) return null;
    return { role, subject, tvId, exp };
  }

  signMedia(relPath: string, ttlMs = MEDIA_URL_TTL_MS): { exp: number; sig: string } {
    // Round expiry to the hour so URLs stay stable (and cacheable) for a while.
    const exp = Math.ceil((this.now() + ttlMs) / 3_600_000) * 3_600_000;
    return { exp, sig: hmac(this.secret, `media:${relPath}:${exp}`) };
  }

  verifyMedia(relPath: string, exp: number, sig: string): boolean {
    if (!Number.isFinite(exp) || exp <= this.now()) return false;
    return safeEqual(sig, hmac(this.secret, `media:${relPath}:${exp}`));
  }
}
