import { createHash } from "node:crypto";

/**
 * DEMO-ONLY in-memory idempotency store.
 *
 * A plan-generation request carries an idempotency key. The first request
 * with a key runs the planner and stores the response; a repeated key
 * returns the stored response byte-identical (deep-equal), so retries and
 * double-submits never create duplicate plan records.
 *
 * The same key with a DIFFERENT payload is rejected (`idempotency_key_reuse`)
 * instead of silently returning a stale plan — that mismatch is a client bug
 * and must be loud.
 *
 * DEMO-ONLY: process-local Map, no TTL, no persistence, not shared across
 * instances. A production deployment replaces this with a durable store
 * (e.g. a plans table keyed by idempotency_key with a UNIQUE constraint and
 * a request-fingerprint column) behind the same interface.
 */

export interface IdempotencyRecord<T> {
  key: string;
  /** SHA-256 of the canonicalised request payload (key excluded). */
  fingerprint: string;
  response: T;
  storedAtMs: number;
}

function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}

/** Stable fingerprint of a request payload (idempotency key excluded by the caller). */
export function fingerprintRequest(payload: unknown): string {
  return createHash("sha256").update(canonicalise(payload)).digest("hex");
}

export class InMemoryIdempotencyStore<T> {
  private records = new Map<string, IdempotencyRecord<T>>();

  /**
   * Look up a key. Returns the stored response when the fingerprint matches,
   * or `{ conflict: true }` when the key was already used for a different
   * payload. Returns null when the key is new.
   */
  lookup(key: string, fingerprint: string): { response: T } | { conflict: true } | null {
    const rec = this.records.get(key);
    if (!rec) return null;
    if (rec.fingerprint !== fingerprint) return { conflict: true };
    // Deep clone so callers cannot mutate the stored record.
    return { response: JSON.parse(JSON.stringify(rec.response)) as T };
  }

  store(key: string, fingerprint: string, response: T): void {
    this.records.set(key, {
      key,
      fingerprint,
      response: JSON.parse(JSON.stringify(response)) as T,
      storedAtMs: Date.now(),
    });
  }

  size(): number {
    return this.records.size;
  }

  /** Test seam: reset the store. */
  clear(): void {
    this.records.clear();
  }
}
