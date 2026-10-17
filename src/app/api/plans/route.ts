import { NextResponse } from "next/server";
import { generatePlan } from "@/lib/plan-service";
import { demoAuthProvider } from "@/lib/demo-auth";
import { requireAction } from "@/lib/auth";
import { TokenBucketRateLimiter } from "@/lib/rate-limit";
import {
  MAX_BODY_BYTES,
  clientKeyFor,
  errorEnvelope,
  parseJsonBody,
  statusForError,
  toInternalError,
} from "@/lib/http";
import { PlanGenerationRequestSchema } from "@/lib/plan-service";

/**
 * POST /api/plans — contract-validated plan generation.
 *
 * Hygiene: 1 MiB body cap, per-client token-bucket rate limit (20 req/min),
 * bearer auth via the DEMO provider (planner role or above), structured
 * error envelopes, no stack traces.
 */
export const dynamic = "force-dynamic";

const rateLimiter = new TokenBucketRateLimiter({ capacity: 20, refillPerSecond: 20 / 60 });

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const rate = rateLimiter.tryConsume(clientKeyFor(req.headers));
    if (!rate.allowed) {
      const res = NextResponse.json(
        errorEnvelope({ code: "rate_limited", retryAfterMs: rate.retryAfterMs }),
        { status: 429 },
      );
      res.headers.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      return res;
    }

    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const auth = await demoAuthProvider.authenticate(token);
    if (!auth.ok) {
      return NextResponse.json(errorEnvelope(auth.error), { status: statusForError(auth.error) });
    }
    const gate = requireAction(auth.value, demoAuthProvider, "plan:generate");
    if (!gate.ok) {
      return NextResponse.json(errorEnvelope(gate.error), { status: statusForError(gate.error) });
    }

    const text = await req.text();
    const body = parseJsonBody(text, PlanGenerationRequestSchema, MAX_BODY_BYTES);
    if (!body.ok) {
      return NextResponse.json(errorEnvelope(body.error), { status: statusForError(body.error) });
    }

    const result = generatePlan(body.value);
    if (!result.ok) {
      return NextResponse.json(errorEnvelope(result.error), { status: statusForError(result.error) });
    }
    return NextResponse.json(result.value, { status: 200 });
  } catch (e) {
    const error = toInternalError(e);
    return NextResponse.json(errorEnvelope(error), { status: 500 });
  }
}
