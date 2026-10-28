import { DevMockAuthProvider } from "./auth";

/**
 * DEMO ONLY — static users for the demo API routes.
 *
 * These tokens are not secrets; they exist so the RBAC adapter can be
 * exercised end-to-end (viewer gets 403 on approve, approver gets 200).
 * A production deployment deletes this file and wires a real AuthProvider
 * (see the real-provider contract in src/lib/auth.ts).
 */

export const DEMO_TOKENS = {
  viewer: "demo-token-viewer",
  planner: "demo-token-planner",
  approver: "demo-token-approver",
  admin: "demo-token-admin",
} as const;

export const demoAuthProvider = new DevMockAuthProvider();
demoAuthProvider.addUser(DEMO_TOKENS.viewer, { id: "demo-viewer", name: "Demo Viewer", roles: ["viewer"] });
demoAuthProvider.addUser(DEMO_TOKENS.planner, { id: "demo-planner", name: "Demo Planner", roles: ["planner"] });
demoAuthProvider.addUser(DEMO_TOKENS.approver, { id: "demo-approver", name: "Demo Approver", roles: ["approver"] });
demoAuthProvider.addUser(DEMO_TOKENS.admin, { id: "demo-admin", name: "Demo Admin", roles: ["admin"] });
