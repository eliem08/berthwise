/**
 * Typed results for the planning service boundary.
 *
 * Library code never throws for expected failures and never silently coerces
 * bad input: every fallible operation returns a `PlanResult` whose error is
 * a structured, serialisable object with no stack traces and no internals.
 * HTTP routes map these codes to status codes (see src/lib/http.ts).
 */

export interface PlanIssue {
  /** Dotted path into the offending payload, e.g. "schedules.2.etdUtc". */
  path: string;
  message: string;
  code: string;
}

export type PlanError =
  | { code: "validation_failed"; issues: PlanIssue[] }
  | { code: "infeasible"; reason: string; details?: PlanIssue[] }
  | { code: "idempotency_key_reuse"; message: string }
  | { code: "rate_limited"; retryAfterMs: number }
  | { code: "body_too_large"; message: string }
  | { code: "unauthorized"; message: string }
  | { code: "forbidden"; message: string }
  | { code: "not_found"; message: string }
  | { code: "conflict"; message: string }
  | { code: "internal_error"; message: string };

export type PlanResult<T> = { ok: true; value: T } | { ok: false; error: PlanError };

export function ok<T>(value: T): PlanResult<T> {
  return { ok: true, value };
}

export function err<T>(error: PlanError): PlanResult<T> {
  return { ok: false, error };
}

/** Flatten a zod parse failure into serialisable issues. */
export function issuesFromZod(
  issues: Array<{ path: readonly (string | number | symbol)[]; message: string; code: string }>,
): PlanIssue[] {
  return issues.map((i) => ({
    path: i.path.length > 0 ? i.path.map((p) => String(p)).join(".") : "(root)",
    message: i.message,
    code: String(i.code),
  }));
}
