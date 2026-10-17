import { NextResponse } from "next/server";
import { z } from "zod";
import { approvePlan } from "@/lib/plan-service";
import { demoAuthProvider } from "@/lib/demo-auth";
import {
  MAX_BODY_BYTES,
  errorEnvelope,
  parseJsonBody,
  statusForError,
  toInternalError,
} from "@/lib/http";

/**
 * POST /api/plans/[id]/approve — approve a proposed plan.
 *
 * Requires the `approver` role: the DevMockAuthProvider denies viewers and
 * planners with a structured 403 (see the RBAC tests). Body: { reason? }.
 */
export const dynamic = "force-dynamic";

const ApproveBodySchema = z.object({ reason: z.string().min(1).max(2000).optional() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;

    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const auth = await demoAuthProvider.authenticate(token);
    if (!auth.ok) {
      return NextResponse.json(errorEnvelope(auth.error), { status: statusForError(auth.error) });
    }

    const text = await req.text();
    const body = parseJsonBody(text, ApproveBodySchema, MAX_BODY_BYTES);
    if (!body.ok) {
      return NextResponse.json(errorEnvelope(body.error), { status: statusForError(body.error) });
    }

    const result = approvePlan(id, auth.value, demoAuthProvider, body.value.reason);
    if (!result.ok) {
      return NextResponse.json(errorEnvelope(result.error), { status: statusForError(result.error) });
    }
    return NextResponse.json({ planId: id, records: result.value }, { status: 200 });
  } catch (e) {
    const error = toInternalError(e);
    return NextResponse.json(errorEnvelope(error), { status: 500 });
  }
}
