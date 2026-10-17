/**
 * In-memory token-bucket rate limiter.
 *
 * Each client key gets a bucket holding up to `capacity` tokens, refilled at
 * `refillPerSecond`. A request consumes one token; when the bucket is empty
 * the request is denied with the milliseconds until the next token arrives
 * (surfaced to HTTP as 429 + Retry-After).
 *
 * In-memory = per-process, lost on restart, not shared across instances.
 * That is acceptable for this demo service; a production deployment moves
 * the buckets to Redis (or the edge) behind the same `tryConsume` shape.
 */

export interface RateLimitConfig {
  /** Burst capacity: max requests in a burst. */
  capacity: number;
  /** Sustained rate: tokens added per second. */
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class TokenBucketRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private readonly config: RateLimitConfig) {
    if (!Number.isFinite(config.capacity) || config.capacity <= 0) {
      throw new Error("rate limiter capacity must be a positive number");
    }
    if (!Number.isFinite(config.refillPerSecond) || config.refillPerSecond <= 0) {
      throw new Error("rate limiter refillPerSecond must be a positive number");
    }
  }

  tryConsume(key: string, nowMs: number = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const { capacity, refillPerSecond } = this.config;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, lastRefillMs: nowMs };
      this.buckets.set(key, bucket);
    }
    const elapsedMs = Math.max(0, nowMs - bucket.lastRefillMs);
    bucket.tokens = Math.min(capacity, bucket.tokens + (elapsedMs / 1000) * refillPerSecond);
    bucket.lastRefillMs = nowMs;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    const retryAfterMs = Math.ceil(((1 - bucket.tokens) / refillPerSecond) * 1000);
    return { allowed: false, retryAfterMs };
  }

  /** Test seam: drop all buckets. */
  clear(): void {
    this.buckets.clear();
  }
}
