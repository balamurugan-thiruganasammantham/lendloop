import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { NotificationType } from "./constants";

/**
 * Notification types that are also forwarded to n8n for email delivery.
 * OTP notifications are deliberately excluded: codes never leave Convex
 * through the automation pipeline.
 */
const AUTOMATION_EVENT_TYPES: Partial<Record<NotificationType, string>> = {
  REQUEST_CREATED: "borrow_request.created",
  REQUEST_APPROVED: "borrow_request.approved",
  REQUEST_DECLINED: "borrow_request.declined",
  REQUEST_CANCELLED: "borrow_request.cancelled",
  REQUEST_EXPIRED: "borrow_request.expired",
  PICKUP_CONFIRMED: "loan.collected",
  RETURN_REQUESTED: "loan.return_requested",
  ITEM_RETURNED: "loan.returned",
  DAMAGE_REPORTED: "loan.damage_reported",
  NOT_RETURNED_REPORTED: "loan.not_returned_reported",
  LOAN_CANCELLED: "loan.cancelled",
  ADMIN_ACTION: "admin.action",
};

export function automationEventTypeFor(type: NotificationType): string | null {
  return AUTOMATION_EVENT_TYPES[type] ?? null;
}

export interface NotifyInput {
  userId: Id<"users">;
  type: NotificationType;
  title: string;
  body: string;
  /** In-app path the notification links to. */
  path: string;
  loanId?: Id<"loans">;
  toolId?: Id<"tools">;
  requestId?: Id<"borrowRequests">;
  toolName?: string;
  status?: string;
}

/**
 * Create an in-app notification and, for email-worthy events, enqueue an
 * outbox record that is delivered to n8n by a scheduled action. Both writes
 * happen in the caller's transaction, so a notification is never sent for a
 * state change that was rolled back.
 */
export async function notify(ctx: MutationCtx, input: NotifyInput): Promise<void> {
  const now = Date.now();
  await ctx.db.insert("notifications", {
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    loanId: input.loanId,
    toolId: input.toolId,
    requestId: input.requestId,
    read: false,
    createdAt: now,
  });

  const eventType = automationEventTypeFor(input.type);
  if (!eventType) return;
  const recipient = await ctx.db.get(input.userId);
  // Seed accounts have no real mailbox; keep them out of the delivery pipeline.
  if (!recipient || recipient.isSeed) return;

  const automationId = await ctx.db.insert("automationEvents", {
    eventId: "pending",
    eventType,
    recipientId: input.userId,
    loanId: input.loanId,
    requestId: input.requestId,
    toolId: input.toolId,
    payload: {
      title: input.title,
      body: input.body,
      path: input.path,
      toolName: input.toolName,
      status: input.status,
    },
    status: "PENDING",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
  // Document ids are unique, which makes them a safe idempotency key for n8n.
  await ctx.db.patch(automationId, { eventId: `evt_${automationId}` });
  await ctx.scheduler.runAfter(0, internal.automation.deliverEvent, { automationEventId: automationId });
}
