import { err, ok, type PlanResult } from "./result";

/**
 * Auth / RBAC adapter.
 *
 * Roles: viewer < planner < approver < admin. Approving a berth plan requires
 * the `approver` role (or `admin`); the mock denies everyone else and the
 * service surfaces that as a `forbidden` typed error.
 *
 * ---------------------------------------------------------------------------
 * REAL-PROVIDER CONTRACT (what a production AuthProvider MUST do):
 *
 * 1. `authenticate(token)` verifies the token cryptographically — e.g. a JWT
 *    signature against the IdP's JWKS, checking `exp`, `nbf`, `aud` and `iss`
 *    — and NEVER trusts a self-asserted role claim from the client.
 * 2. Roles come from a server-side mapping (IdP groups / claims → Role),
 *    never from a request body or header the caller controls.
 * 3. Tokens are never logged, never echoed in error responses, and never
 *    persisted. Compare secrets in constant time where applicable.
 * 4. `authorize(user, action)` is a pure function of the resolved user and
 *    the action; every mutating service entry point calls it BEFORE doing
 *    any work, and denies closed (unknown action → deny).
 * 5. Authentication failures and authorization denials are rate-limited and
 *    audit-logged (without the token value).
 *
 * The DevMockAuthProvider below implements the same interface with a static
 * user table and plain-text demo tokens. It is for local development and
 * tests ONLY — it performs no cryptography and must never be deployed.
 * ---------------------------------------------------------------------------
 */

export type Role = "viewer" | "planner" | "approver" | "admin";

export type Action = "plan:read" | "plan:generate" | "plan:approve" | "plan:supersede";

export interface User {
  id: string;
  name: string;
  roles: Role[];
}

const ROLE_ACTIONS: Record<Role, Action[]> = {
  viewer: ["plan:read"],
  planner: ["plan:read", "plan:generate", "plan:supersede"],
  approver: ["plan:read", "plan:generate", "plan:approve", "plan:supersede"],
  admin: ["plan:read", "plan:generate", "plan:approve", "plan:supersede"],
};

export function actionsForRole(role: Role): readonly Action[] {
  return ROLE_ACTIONS[role] ?? [];
}

export interface AuthProvider {
  /** Resolve a bearer token to a user. Fails closed on unknown/invalid tokens. */
  authenticate(token: string): Promise<PlanResult<User>>;
  /** Pure role check: does this user hold a role that grants the action? */
  authorize(user: User, action: Action): boolean;
}

/**
 * DEMO ONLY — no cryptography, static user table, plain-text demo tokens.
 * Do not deploy. See the real-provider contract above.
 */
/**
 * Demo auth is allowed outside production, or in production only with the
 * explicit opt-in ENABLE_DEMO_AUTH=true (e.g. a public demo deployment).
 * Evaluated per call so tests can toggle it.
 */
export function demoAuthEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_AUTH === "true";
}

export class DevMockAuthProvider implements AuthProvider {
  private users = new Map<string, User>();

  /** Register a demo user under a demo token. */
  addUser(token: string, user: User): void {
    this.users.set(token, { ...user, roles: [...user.roles] });
  }

  async authenticate(token: string): Promise<PlanResult<User>> {
    // Fail closed: the published demo tokens must not work in production.
    if (!demoAuthEnabled()) {
      return err({ code: "unauthorized", message: "demo authentication is disabled in production; no auth provider configured" });
    }
    const user = this.users.get(token);
    if (!user || token.length === 0) {
      return err({ code: "unauthorized", message: "unknown or missing credentials" });
    }
    return ok({ ...user, roles: [...user.roles] });
  }

  authorize(user: User, action: Action): boolean {
    return user.roles.some((role) => (ROLE_ACTIONS[role] ?? []).includes(action));
  }
}

/** Fail-closed gate used by every mutating entry point. */
export function requireAction(user: User, provider: AuthProvider, action: Action): PlanResult<User> {
  if (!provider.authorize(user, action)) {
    return err({
      code: "forbidden",
      message: `role(s) [${user.roles.join(", ")}] do not grant ${action}`,
    });
  }
  return ok(user);
}

/** Highest role in the hierarchy — used for audit labeling. */
export function primaryRole(user: User): Role {
  const order: Role[] = ["viewer", "planner", "approver", "admin"];
  let best: Role = "viewer";
  for (const r of user.roles) {
    if (order.indexOf(r) > order.indexOf(best)) best = r;
  }
  return best;
}
