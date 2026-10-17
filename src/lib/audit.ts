import { randomUUID } from "node:crypto";
import {
  AUDIT_CONTRACT_VERSION,
  AuditEventSchema,
  type AuditEvent,
  type AuditEventType,
} from "../contracts";

/**
 * Append-only audit log for plan lifecycle events.
 *
 * Records planning approvals and plan supersessions with before/after plan
 * ids, the approver and the reason. The log is append-only by construction:
 * readers get a frozen copy, there is no update or delete API, and every
 * entry is validated against the AuditEvent contract before it lands.
 *
 * DEV-LABELED: process-local array, lost on restart. A production deployment
 * persists this to an append-only table (write-once, no UPDATE/DELETE grants
 * for the app role) behind the same interface.
 */

export interface AuditAppendInput {
  type: AuditEventType;
  planId: string;
  previousPlanId?: string;
  actor: string;
  role: string;
  reason?: string;
  createdAtUtc?: string;
}

export class AuditLog {
  private events: AuditEvent[] = [];

  append(input: AuditAppendInput): AuditEvent {
    const event = AuditEventSchema.parse({
      contractVersion: AUDIT_CONTRACT_VERSION,
      eventId: `evt_${randomUUID()}`,
      type: input.type,
      planId: input.planId,
      previousPlanId: input.previousPlanId,
      actor: input.actor,
      role: input.role,
      reason: input.reason,
      createdAtUtc: input.createdAtUtc ?? new Date().toISOString(),
    });
    this.events.push(event);
    return event;
  }

  /** Frozen snapshot — callers cannot mutate the log through the result. */
  list(): readonly AuditEvent[] {
    return Object.freeze(this.events.slice());
  }

  eventsForPlan(planId: string): readonly AuditEvent[] {
    return Object.freeze(this.events.filter((e) => e.planId === planId || e.previousPlanId === planId));
  }

  count(): number {
    return this.events.length;
  }

  /** Test seam: reset the log. */
  clear(): void {
    this.events = [];
  }
}

/** Shared process-local audit log for the demo service. */
export const auditLog = new AuditLog();
