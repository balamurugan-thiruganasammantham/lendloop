/**
 * Time-based lifecycle transitions and housekeeping, run by crons.ts.
 * Each job processes a bounded batch and reschedules itself if more work
 * remains, keeping individual transactions small.
 */
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { PICKUP_WINDOW_MS, TIME } from "./lib/constants";
import { supersedeOtps, transitionLoan } from "./lib/loans";
import { notify } from "./lib/notify";
import { recomputeToolStatus } from "./lib/toolStatus";

const BATCH = 100;

/** ACTIVE_LOAN past its return time → OVERDUE (notifies both parties once). */
export const markOverdueLoans = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const late = await ctx.db
      .query("loans")
      .withIndex("by_status_returnBy", (q) => q.eq("status", "ACTIVE_LOAN").lt("returnBy", now))
      .take(BATCH);
    for (const loan of late) {
      await transitionLoan(ctx, loan, "OVERDUE", { role: "SYSTEM" }, { wasOverdue: true });
      await recomputeToolStatus(ctx, loan.toolId);
      await notify(ctx, {
        userId: loan.borrowerId,
        type: "LOAN_OVERDUE",
        title: "Return overdue",
        body: `${loan.toolName} was due back. Start the return or contact the owner to agree a new time.`,
        path: `/loans/${loan._id}`,
        loanId: loan._id,
        toolId: loan.toolId,
      });
      await notify(ctx, {
        userId: loan.ownerId,
        type: "LOAN_OVERDUE",
        title: "Loan overdue",
        body: `${loan.toolName} has not been returned on time. We have reminded the borrower.`,
        path: `/loans/${loan._id}`,
        loanId: loan._id,
        toolId: loan.toolId,
      });
    }
    if (late.length === BATCH) await ctx.scheduler.runAfter(0, internal.scheduled.markOverdueLoans, {});
    return late.length;
  },
});

/** Pending requests whose pickup time has passed can no longer be approved. */
export const expireStaleRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("borrowRequests")
      .withIndex("by_status_pickup", (q) => q.eq("status", "PENDING").lt("pickupAt", now))
      .take(BATCH);
    const tools = new Set<Id<"tools">>();
    for (const r of stale) {
      await ctx.db.patch(r._id, { status: "EXPIRED", decidedAt: now, updatedAt: now });
      await writeAudit(ctx, {
        actorType: "SYSTEM",
        action: "request.expired",
        resourceType: "request",
        resourceId: r._id,
        fromStatus: "PENDING",
        toStatus: "EXPIRED",
      });
      const tool = await ctx.db.get(r.toolId);
      await notify(ctx, {
        userId: r.borrowerId,
        type: "REQUEST_EXPIRED",
        title: "Request expired",
        body: `Your request for ${tool?.name ?? "a tool"} expired because the pickup time passed without a response.`,
        path: "/requests?tab=CANCELLED",
        requestId: r._id,
        toolId: r.toolId,
        toolName: tool?.name,
        status: "EXPIRED",
      });
      tools.add(r.toolId);
    }
    for (const toolId of tools) await recomputeToolStatus(ctx, toolId);
    if (stale.length === BATCH) await ctx.scheduler.runAfter(0, internal.scheduled.expireStaleRequests, {});
    return stale.length;
  },
});

/** Approved loans never collected within the pickup window are released. */
export const cancelMissedPickups = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - PICKUP_WINDOW_MS;
    let count = 0;
    for (const status of ["APPROVED", "COLLECTION_OTP_PENDING"] as const) {
      const missed = await ctx.db
        .query("loans")
        .withIndex("by_status_pickup", (q) => q.eq("status", status).lt("pickupAt", cutoff))
        .take(BATCH);
      for (const loan of missed) {
        await transitionLoan(
          ctx,
          loan,
          "CANCELLED",
          { role: "SYSTEM" },
          { cancelledAt: Date.now(), cancelReason: "Pickup window passed without collection" },
        );
        await supersedeOtps(ctx, loan._id);
        await recomputeToolStatus(ctx, loan.toolId);
        for (const userId of [loan.borrowerId, loan.ownerId]) {
          await notify(ctx, {
            userId,
            type: "LOAN_CANCELLED",
            title: "Loan cancelled",
            body: `The loan of ${loan.toolName} was cancelled because it was not collected within 48 hours of the pickup time.`,
            path: `/loans/${loan._id}`,
            loanId: loan._id,
            toolId: loan.toolId,
            toolName: loan.toolName,
            status: "CANCELLED",
          });
        }
        count++;
      }
    }
    return count;
  },
});

/** Purge short-lived operational data. */
export const housekeeping = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const oldNonces = await ctx.db
      .query("webhookEvents")
      .withIndex("by_received", (q) => q.lt("receivedAt", now - 7 * TIME.day))
      .take(500);
    for (const n of oldNonces) await ctx.db.delete(n._id);

    const staleLimits = await ctx.db
      .query("rateLimits")
      .filter((q) => q.lt(q.field("windowStart"), now - TIME.day))
      .take(500);
    for (const r of staleLimits) await ctx.db.delete(r._id);

    // Uploads never attached to a listing/return/damage report within 24h.
    const orphans = await ctx.db
      .query("uploads")
      .withIndex("by_attached_created", (q) => q.eq("attached", false).lt("createdAt", now - TIME.day))
      .take(200);
    for (const u of orphans) {
      await ctx.storage.delete(u.storageId);
      await ctx.db.delete(u._id);
    }

    await ctx.runMutation(internal.devMailbox.purgeExpired, {});
    return { nonces: oldNonces.length, rateLimits: staleLimits.length, orphans: orphans.length };
  },
});
