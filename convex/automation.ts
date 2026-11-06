/**
 * n8n integration (internal functions).
 *
 * Outbound (Convex → n8n): every email-worthy notification inserts an
 * `automationEvents` outbox row in the same transaction as the state change.
 * `deliverEvent` POSTs a minimal, HMAC-signed payload to the n8n webhook and
 * retries with exponential backoff; exhausted events become DEAD and are
 * visible/retryable in the admin panel.
 *
 * Inbound (n8n → Convex): signed HTTP endpoints in http.ts call the internal
 * mutations below for idempotent claims (event + reminder dedup), delivery
 * reports, workflow run summaries and error records.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { TIME } from "./lib/constants";
import { EVENT_ID_HEADER, NONCE_HEADER, SIGNATURE_HEADER, signRequest, TIMESTAMP_HEADER } from "./lib/crypto";
import { displayName } from "./lib/projections";
import { reminderKey, retryDelayMs } from "./lib/rules";
import { redactSensitive } from "./lib/sanitize";
import { vDeliveryResult } from "./validators";

const CLAIM_LEASE_MS = 5 * TIME.minute;

// ---------------------------------------------------------------------------
// Outbound delivery
// ---------------------------------------------------------------------------

export const getEventForDelivery = internalQuery({
  args: { automationEventId: v.id("automationEvents") },
  handler: async (ctx, { automationEventId }) => {
    const ev = await ctx.db.get(automationEventId);
    if (!ev) return null;
    const recipient = await ctx.db.get(ev.recipientId);
    return {
      eventId: ev.eventId,
      eventType: ev.eventType,
      status: ev.status,
      attempts: ev.attempts,
      createdAt: ev.createdAt,
      payload: ev.payload,
      loanId: ev.loanId ?? null,
      requestId: ev.requestId ?? null,
      toolId: ev.toolId ?? null,
      recipient: recipient ? { userId: recipient._id, email: recipient.email, displayName: displayName(recipient.name) } : null,
    };
  },
});

/** Payload contract sent to n8n. Keep minimal: no OTPs, coordinates or secrets. */
export interface AutomationWebhookPayload {
  schemaVersion: 1;
  eventId: string;
  eventType: string;
  occurredAt: string;
  recipient: { userId: string; email: string; displayName: string };
  subject: { requestId: string | null; loanId: string | null; toolId: string | null; toolName: string | null; status: string | null };
  message: { title: string; body: string };
  link: string;
}

export const deliverEvent = internalAction({
  args: { automationEventId: v.id("automationEvents") },
  handler: async (ctx, { automationEventId }) => {
    const ev = await ctx.runQuery(internal.automation.getEventForDelivery, { automationEventId });
    if (!ev || ev.status === "DELIVERED" || ev.status === "DEAD" || ev.status === "SKIPPED") return null;
    if (!ev.recipient || !ev.recipient.email) {
      await ctx.runMutation(internal.automation.recordAttempt, {
        automationEventId,
        outcome: "SKIPPED",
        error: "Recipient has no email address",
      });
      return null;
    }
    const url = process.env.N8N_WEBHOOK_URL;
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (!url || !secret) {
      // Clearly recorded rather than silently dropped; in-app notification already exists.
      await ctx.runMutation(internal.automation.recordAttempt, {
        automationEventId,
        outcome: "SKIPPED",
        error: "n8n is not configured (N8N_WEBHOOK_URL / N8N_WEBHOOK_SECRET)",
      });
      return null;
    }

    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const payload: AutomationWebhookPayload = {
      schemaVersion: 1,
      eventId: ev.eventId,
      eventType: ev.eventType,
      occurredAt: new Date(ev.createdAt).toISOString(),
      recipient: { userId: ev.recipient.userId, email: ev.recipient.email, displayName: ev.recipient.displayName },
      subject: {
        requestId: ev.requestId,
        loanId: ev.loanId,
        toolId: ev.toolId,
        toolName: ev.payload.toolName ?? null,
        status: ev.payload.status ?? null,
      },
      message: { title: ev.payload.title, body: ev.payload.body },
      link: `${appUrl}${ev.payload.path}`,
    };
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();
    const signature = await signRequest(secret, timestamp, nonce, body);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [SIGNATURE_HEADER]: signature,
          [TIMESTAMP_HEADER]: String(timestamp),
          [NONCE_HEADER]: nonce,
          [EVENT_ID_HEADER]: ev.eventId,
        },
        body,
        signal: controller.signal,
      });
      if (res.ok) {
        await ctx.runMutation(internal.automation.recordAttempt, { automationEventId, outcome: "DELIVERED" });
      } else {
        await ctx.runMutation(internal.automation.recordAttempt, {
          automationEventId,
          outcome: "FAILED",
          error: `n8n responded with HTTP ${res.status}`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? (error.name === "AbortError" ? "Request timed out" : error.message) : "Unknown error";
      await ctx.runMutation(internal.automation.recordAttempt, {
        automationEventId,
        outcome: "FAILED",
        error: redactSensitive(message, 300),
      });
    } finally {
      clearTimeout(timer);
    }
    return null;
  },
});

export const recordAttempt = internalMutation({
  args: {
    automationEventId: v.id("automationEvents"),
    outcome: v.union(v.literal("DELIVERED"), v.literal("FAILED"), v.literal("SKIPPED")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { automationEventId, outcome, error }) => {
    const ev = await ctx.db.get(automationEventId);
    if (!ev) return null;
    const now = Date.now();
    if (outcome === "SKIPPED") {
      await ctx.db.patch(ev._id, { status: "SKIPPED", lastError: error, lastAttemptAt: now, updatedAt: now });
      return null;
    }
    const attempts = ev.attempts + 1;
    if (outcome === "DELIVERED") {
      await ctx.db.patch(ev._id, {
        status: "DELIVERED",
        attempts,
        deliveredAt: now,
        lastAttemptAt: now,
        lastError: undefined,
        nextAttemptAt: undefined,
        updatedAt: now,
      });
      return null;
    }
    const delay = retryDelayMs(attempts);
    if (delay === null) {
      await ctx.db.patch(ev._id, { status: "DEAD", attempts, lastError: error, lastAttemptAt: now, nextAttemptAt: undefined, updatedAt: now });
      await ctx.db.insert("automationFailures", {
        workflowName: "convex.outbound_delivery",
        errorMessage: `Delivery to n8n failed after ${attempts} attempts: ${error ?? "unknown error"}`,
        relatedEventId: ev.eventId,
        occurredAt: now,
        status: "OPEN",
      });
      await writeAudit(ctx, {
        actorType: "SYSTEM",
        action: "automation.dead_lettered",
        resourceType: "automation",
        resourceId: ev.eventId,
        meta: { attempts },
      });
      return null;
    }
    await ctx.db.patch(ev._id, {
      status: "FAILED",
      attempts,
      lastError: error,
      lastAttemptAt: now,
      nextAttemptAt: now + delay,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(delay, internal.automation.deliverEvent, { automationEventId });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Inbound (called from signed HTTP endpoints)
// ---------------------------------------------------------------------------

/** Replay protection: each signed request nonce can be used once. */
export const claimNonce = internalMutation({
  args: { nonce: v.string(), route: v.string(), relatedEventId: v.optional(v.string()) },
  handler: async (ctx, { nonce, route, relatedEventId }) => {
    const seen = await ctx.db
      .query("webhookEvents")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .first();
    if (seen) return { replay: true };
    await ctx.db.insert("webhookEvents", {
      source: "n8n",
      nonce,
      route,
      relatedEventId,
      outcome: "accepted",
      receivedAt: Date.now(),
    });
    return { replay: false };
  },
});

/**
 * n8n claims an event before sending email. Returns "duplicate" if it was
 * already delivered, "in_progress" if another execution holds a fresh lease.
 */
export const claimEvent = internalMutation({
  args: { eventId: v.string(), executionId: v.optional(v.string()) },
  handler: async (ctx, { eventId }) => {
    const ev = await ctx.db
      .query("automationEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
      .unique();
    if (!ev) return { status: "unknown" as const };
    if (ev.deliveryResult === "SENT" || ev.deliveryResult === "MOCKED") return { status: "duplicate" as const };
    const now = Date.now();
    if (ev.claimedAt && now - ev.claimedAt < CLAIM_LEASE_MS && ev.deliveryResult === undefined) {
      return { status: "in_progress" as const };
    }
    await ctx.db.patch(ev._id, { claimedAt: now, deliveryResult: undefined, updatedAt: now });
    return { status: "claimed" as const };
  },
});

export const reportEventDelivery = internalMutation({
  args: {
    eventId: v.string(),
    result: vDeliveryResult,
    error: v.optional(v.string()),
    executionId: v.optional(v.string()),
  },
  handler: async (ctx, { eventId, result, error, executionId }) => {
    const ev = await ctx.db
      .query("automationEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", eventId))
      .unique();
    if (!ev) return { ok: false };
    const now = Date.now();
    await ctx.db.patch(ev._id, {
      deliveryResult: result,
      deliveryReportedAt: now,
      deliveryError: error ? redactSensitive(error, 300) : undefined,
      // Release the lease on failure so a retry can claim it again.
      claimedAt: result === "FAILED" ? undefined : ev.claimedAt,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      actorType: "AUTOMATION",
      action: "automation.delivery_reported",
      resourceType: "automation",
      resourceId: eventId,
      toStatus: result,
      meta: { executionId: executionId ?? null },
    });
    return { ok: true };
  },
});

/** Overdue loans that have not yet had a reminder in this period. */
export const overdueCandidates = internalQuery({
  args: { period: v.string(), limit: v.number() },
  handler: async (ctx, { period, limit }) => {
    const now = Date.now();
    const overdue = await ctx.db
      .query("loans")
      .withIndex("by_status", (q) => q.eq("status", "OVERDUE"))
      .take(500);
    const lateActive = await ctx.db
      .query("loans")
      .withIndex("by_status_returnBy", (q) => q.eq("status", "ACTIVE_LOAN").lt("returnBy", now))
      .take(500);
    const result: { loanId: Id<"loans">; reminderKey: string; daysOverdue: number }[] = [];
    for (const loan of [...overdue, ...lateActive]) {
      if (result.length >= limit) break;
      const key = reminderKey(loan._id, period);
      const existing = await ctx.db
        .query("automationReminders")
        .withIndex("by_key", (q) => q.eq("reminderKey", key))
        .unique();
      if (existing && (existing.status === "SENT" || existing.status === "MOCKED")) continue;
      result.push({ loanId: loan._id, reminderKey: key, daysOverdue: Math.max(1, Math.floor((now - loan.returnBy) / TIME.day)) });
    }
    return result;
  },
});

export const claimReminder = internalMutation({
  args: { loanId: v.string(), period: v.string(), executionId: v.optional(v.string()) },
  handler: async (ctx, { loanId, period, executionId }) => {
    const id = ctx.db.normalizeId("loans", loanId);
    if (!id) return { status: "unknown" as const };
    const loan = await ctx.db.get(id);
    if (!loan) return { status: "unknown" as const };
    const now = Date.now();
    if (!(loan.status === "OVERDUE" || (loan.status === "ACTIVE_LOAN" && loan.returnBy < now))) {
      return { status: "not_overdue" as const };
    }
    const borrower = await ctx.db.get(loan.borrowerId);
    if (!borrower || borrower.isSeed) return { status: "skipped" as const, reason: "seed_or_missing_recipient" };

    const key = reminderKey(loan._id, period);
    const existing = await ctx.db
      .query("automationReminders")
      .withIndex("by_key", (q) => q.eq("reminderKey", key))
      .unique();
    if (existing) {
      if (existing.status === "SENT" || existing.status === "MOCKED") return { status: "duplicate" as const };
      if (existing.status === "CLAIMED" && now - existing.claimedAt < CLAIM_LEASE_MS) return { status: "in_progress" as const };
      await ctx.db.patch(existing._id, { status: "CLAIMED", attempts: existing.attempts + 1, claimedAt: now, executionId, error: undefined });
    } else {
      await ctx.db.insert("automationReminders", {
        loanId: loan._id,
        period,
        reminderKey: key,
        status: "CLAIMED",
        attempts: 1,
        claimedAt: now,
        executionId,
      });
    }
    const owner = await ctx.db.get(loan.ownerId);
    const daysOverdue = Math.max(1, Math.floor((now - loan.returnBy) / TIME.day));
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return {
      status: "claimed" as const,
      reminderKey: key,
      recipient: { email: borrower.email, displayName: displayName(borrower.name) },
      message: {
        subject: `Reminder: ${loan.toolName} is ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`,
        body: `${loan.toolName} was due back to ${displayName(owner?.name ?? "the owner")} on ${new Date(loan.returnBy).toUTCString()}. Please start the return in LendLoop or contact the owner to arrange a new time.`,
      },
      link: `${appUrl}/loans/${loan._id}`,
    };
  },
});

export const reportReminder = internalMutation({
  args: {
    loanId: v.string(),
    period: v.string(),
    result: v.union(v.literal("SENT"), v.literal("MOCKED"), v.literal("FAILED")),
    error: v.optional(v.string()),
    executionId: v.optional(v.string()),
  },
  handler: async (ctx, { loanId, period, result, error, executionId }) => {
    const id = ctx.db.normalizeId("loans", loanId);
    if (!id) return { ok: false };
    const existing = await ctx.db
      .query("automationReminders")
      .withIndex("by_key", (q) => q.eq("reminderKey", reminderKey(id, period)))
      .unique();
    if (!existing) return { ok: false };
    await ctx.db.patch(existing._id, {
      status: result,
      completedAt: Date.now(),
      error: error ? redactSensitive(error, 300) : undefined,
      executionId: executionId ?? existing.executionId,
    });
    return { ok: true };
  },
});

export const recordRun = internalMutation({
  args: {
    workflowName: v.string(),
    executionId: v.optional(v.string()),
    processed: v.number(),
    sent: v.number(),
    skipped: v.number(),
    failed: v.number(),
    startedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("automationRuns", { ...args, workflowName: args.workflowName.slice(0, 100), finishedAt: Date.now() });
    return { ok: true };
  },
});

export const recordFailure = internalMutation({
  args: {
    workflowName: v.string(),
    executionId: v.optional(v.string()),
    failedNode: v.optional(v.string()),
    errorMessage: v.string(),
    relatedEventId: v.optional(v.string()),
    occurredAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("automationFailures", {
      workflowName: args.workflowName.slice(0, 100),
      executionId: args.executionId?.slice(0, 100),
      failedNode: args.failedNode?.slice(0, 100),
      errorMessage: redactSensitive(args.errorMessage, 500),
      relatedEventId: args.relatedEventId?.slice(0, 100),
      occurredAt: args.occurredAt ?? Date.now(),
      status: "OPEN",
    });
    // If the failure belongs to an outbound event, release its lease so it can be retried.
    if (args.relatedEventId) {
      const ev = await ctx.db
        .query("automationEvents")
        .withIndex("by_event_id", (q) => q.eq("eventId", args.relatedEventId!))
        .unique();
      if (ev && ev.deliveryResult !== "SENT" && ev.deliveryResult !== "MOCKED") {
        await ctx.db.patch(ev._id, { deliveryResult: "FAILED", claimedAt: undefined, deliveryError: "n8n workflow error", updatedAt: Date.now() });
      }
    }
    return { ok: true, id };
  },
});
