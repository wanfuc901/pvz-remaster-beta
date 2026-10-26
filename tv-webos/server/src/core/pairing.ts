/**
 * In-memory pairing state: short-lived QR tokens / 6-digit codes, and pending
 * pairing requests waiting for on-screen confirmation.
 *
 * Security properties:
 * - QR tokens carry 128 bits of entropy and are single-use.
 * - 6-digit codes are single-use, expire with the token, and every failed
 *   lookup counts against both a per-IP limiter (handled by the caller) and a
 *   global failure budget that temporarily disables code pairing server-wide.
 * - Pairing via a manual code always needs confirmation on the TV.
 */
import { PAIR_TOKEN_TTL_MS } from '@tvwebos/shared';
import { randomDigits, randomId, randomToken } from './crypto.js';

export interface PairTicket {
  tvId: string;
  token: string;
  code: string;
  expiresAt: number;
}

export interface PendingRequest {
  requestId: string;
  tvId: string;
  name: string;
  platform: string;
  ip: string;
  verifyCode: string;
  method: 'qr' | 'code';
  expiresAt: number;
}

export type ConsumeResult =
  | { ok: true; tvId: string; method: 'qr' | 'code' }
  | { ok: false; reason: 'pair_invalid' | 'pair_expired' | 'rate_limited' };

export const PENDING_TTL_MS = 60_000;
const MAX_PENDING_PER_TV = 3;
const GLOBAL_CODE_FAILURE_BUDGET = 60;
const GLOBAL_CODE_WINDOW_MS = 60_000;

export class PairingManager {
  private readonly byToken = new Map<string, PairTicket>();
  private readonly byCode = new Map<string, PairTicket>();
  private readonly byTv = new Map<string, PairTicket>();
  private readonly pending = new Map<string, PendingRequest>();
  private codeFailures: number[] = [];

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = PAIR_TOKEN_TTL_MS,
  ) {}

  /** Issue a fresh ticket for a TV, invalidating its previous one. */
  issue(tvId: string): PairTicket {
    this.revokeTicket(tvId);
    let code: string;
    do code = randomDigits(6);
    while (this.byCode.has(code));
    const ticket: PairTicket = { tvId, token: randomToken(16), code, expiresAt: this.now() + this.ttlMs };
    this.byToken.set(ticket.token, ticket);
    this.byCode.set(ticket.code, ticket);
    this.byTv.set(tvId, ticket);
    return ticket;
  }

  revokeTicket(tvId: string): void {
    const old = this.byTv.get(tvId);
    if (!old) return;
    this.byToken.delete(old.token);
    this.byCode.delete(old.code);
    this.byTv.delete(tvId);
  }

  /** Look up and burn a ticket by QR token or manual code. */
  consume(input: { token?: string; code?: string }): ConsumeResult {
    const t = this.now();
    let ticket: PairTicket | undefined;
    let method: 'qr' | 'code';
    if (input.token) {
      method = 'qr';
      ticket = this.byToken.get(input.token);
    } else if (input.code) {
      method = 'code';
      this.codeFailures = this.codeFailures.filter((x) => t - x < GLOBAL_CODE_WINDOW_MS);
      if (this.codeFailures.length >= GLOBAL_CODE_FAILURE_BUDGET) return { ok: false, reason: 'rate_limited' };
      ticket = this.byCode.get(input.code);
      if (!ticket) this.codeFailures.push(t);
    } else {
      return { ok: false, reason: 'pair_invalid' };
    }
    if (!ticket) return { ok: false, reason: 'pair_invalid' };
    this.revokeTicket(ticket.tvId);
    if (ticket.expiresAt <= t) return { ok: false, reason: 'pair_expired' };
    return { ok: true, tvId: ticket.tvId, method };
  }

  // ---- Pending confirmation -------------------------------------------

  createPending(req: Omit<PendingRequest, 'requestId' | 'verifyCode' | 'expiresAt'>): PendingRequest | null {
    this.expirePending();
    const forTv = [...this.pending.values()].filter((p) => p.tvId === req.tvId);
    if (forTv.length >= MAX_PENDING_PER_TV) return null;
    const pending: PendingRequest = {
      ...req,
      requestId: randomId(),
      verifyCode: randomDigits(4),
      expiresAt: this.now() + PENDING_TTL_MS,
    };
    this.pending.set(pending.requestId, pending);
    return pending;
  }

  getPending(requestId: string): PendingRequest | null {
    const p = this.pending.get(requestId);
    if (!p) return null;
    if (p.expiresAt <= this.now()) {
      this.pending.delete(requestId);
      return null;
    }
    return p;
  }

  takePending(requestId: string): PendingRequest | null {
    const p = this.getPending(requestId);
    if (p) this.pending.delete(requestId);
    return p;
  }

  /** Remove and return expired pending requests. */
  expirePending(): PendingRequest[] {
    const t = this.now();
    const expired: PendingRequest[] = [];
    for (const [id, p] of this.pending) {
      if (p.expiresAt <= t) {
        this.pending.delete(id);
        expired.push(p);
      }
    }
    return expired;
  }

  /** Drop expired tickets; returns TV ids whose ticket expired (so a fresh one can be pushed). */
  expireTickets(): string[] {
    const t = this.now();
    const tvs: string[] = [];
    for (const ticket of this.byTv.values()) {
      if (ticket.expiresAt <= t) tvs.push(ticket.tvId);
    }
    for (const tvId of tvs) this.revokeTicket(tvId);
    return tvs;
  }
}
