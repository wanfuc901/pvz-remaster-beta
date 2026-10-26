/**
 * Token bucket. `capacity` tokens, refilled continuously at `perSecond`.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.perSecond);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** A set of token buckets keyed by string (e.g. client IP), with idle eviction. */
export class KeyedRateLimiter {
  private readonly buckets = new Map<string, { bucket: TokenBucket; seen: number }>();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string, cost = 1): boolean {
    let entry = this.buckets.get(key);
    if (!entry) {
      if (this.buckets.size > 10_000) this.sweep(true);
      entry = { bucket: new TokenBucket(this.capacity, this.perSecond, this.now), seen: 0 };
      this.buckets.set(key, entry);
    }
    entry.seen = this.now();
    return entry.bucket.take(cost);
  }

  /** Drop buckets that have been idle long enough to be full again. */
  sweep(force = false): void {
    const idleMs = (this.capacity / this.perSecond) * 1000;
    const t = this.now();
    for (const [key, entry] of this.buckets) {
      if (force || t - entry.seen > idleMs) this.buckets.delete(key);
    }
  }
}
