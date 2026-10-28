/**
 * Regression: src/lib/demo-auth.ts ships static, publicly documented tokens
 * (e.g. "demo-token-admin"). Before the fix they authenticated in any
 * environment, so a production deployment would have accepted them. The demo
 * provider must fail closed in production unless ENABLE_DEMO_AUTH=true.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { demoAuthEnabled } from "../auth";
import { DEMO_TOKENS, demoAuthProvider } from "../demo-auth";
import { POST as approvePOST } from "../../app/api/plans/[id]/approve/route";

function approveRequest(token: string) {
  return approvePOST(
    new Request("http://localhost/api/plans/plan-x/approve", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason: "attempted with published demo token" }),
    }),
    { params: Promise.resolve({ id: "plan-x" }) },
  );
}

describe("demo auth fails closed in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("outside production the demo tokens authenticate", async () => {
    expect(demoAuthEnabled()).toBe(true);
    const r = await demoAuthProvider.authenticate(DEMO_TOKENS.admin);
    expect(r.ok).toBe(true);
  });

  it("in production the published admin token is rejected as unauthorized (401)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEMO_AUTH", "");
    expect(demoAuthEnabled()).toBe(false);
    const r = await demoAuthProvider.authenticate(DEMO_TOKENS.admin);
    expect(r.ok).toBe(false);
    const res = await approveRequest(DEMO_TOKENS.admin);
    expect(res.status).toBe(401);
  });

  it("production with explicit ENABLE_DEMO_AUTH=true re-enables the demo (opt-in only)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEMO_AUTH", "true");
    const r = await demoAuthProvider.authenticate(DEMO_TOKENS.admin);
    expect(r.ok).toBe(true);
  });
});
