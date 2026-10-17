import { z } from "zod";
import { err, issuesFromZod, ok, type PlanError, type PlanResult } from "./result";

/**
 * HTTP hygiene for the demo API routes.
 *
 * - Request bodies are size-capped BEFORE parsing: oversized payloads are
 *   rejected with 413 and never deserialised.
 * - All failures surface as structured `{ error, message?, issues? }`
 *   envelopes. Stack traces and internals are NEVER included — unexpected
 *   exceptions map to a generic 500.
 * - Typed `PlanError` codes map to HTTP status codes in one place.
 */

/** Max JSON body accepted by the API: 1 MiB. */
export const MAX_BODY_BYTES = 1_048_576;

const STATUS_FOR_CODE: Record<PlanError["code"], number> = {
  validation_failed: 400,
  body_too_large: 413,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  infeasible: 422,
  idempotency_key_reuse: 409,
  rate_limited: 429,
  internal_error: 500,
};

export function statusForError(error: PlanError): number {
  return STATUS_FOR_CODE[error.code] ?? 500;
}

export function errorEnvelope(error: PlanError): Record<string, unknown> {
  const envelope: Record<string, unknown> = { error: error.code };
  if ("message" in error && error.message) envelope.message = error.message;
  if ("reason" in error && error.reason) envelope.message = error.reason;
  if ("issues" in error && error.issues) envelope.issues = error.issues;
  if ("details" in error && error.details) envelope.details = error.details;
  if ("retryAfterMs" in error) envelope.retryAfterMs = error.retryAfterMs;
  return envelope;
}

/**
 * Read and validate a JSON body with a byte cap. The caller passes the raw
 * text (from `req.text()`); parsing happens only when the cap allows it.
 */
export function parseJsonBody<T>(text: string, schema: z.ZodType<T>, maxBytes = MAX_BODY_BYTES): PlanResult<T> {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    return err({
      code: "body_too_large",
      message: `request body of ${bytes} bytes exceeds the ${maxBytes}-byte limit`,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err({
      code: "validation_failed",
      issues: [{ path: "(body)", message: "request body must be valid JSON", code: "invalid_json" }],
    });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return err({ code: "validation_failed", issues: issuesFromZod(result.error.issues) });
  }
  return ok(result.data);
}

/** Map an unexpected exception to a generic 500 — never leak internals. */
export function toInternalError(e: unknown): PlanError {
  // Deliberately discards the original error: no message, no stack.
  void e;
  return { code: "internal_error", message: "unexpected error processing the request" };
}

/** Client identity for rate limiting: explicit key header, else "anonymous". */
export function clientKeyFor(headers: Headers): string {
  const explicit = headers.get("x-client-key");
  if (explicit && explicit.trim().length > 0) return `key:${explicit.trim().slice(0, 128)}`;
  return "anonymous";
}
