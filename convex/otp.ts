/**
 * OTP persistence and verification (internal only).
 *
 * Codes are generated and hashed in actions (see otpActions.ts) where secure
 * randomness is available. These internal mutations store the hash and
 * perform the atomic compare-and-transition. Plaintext codes never reach the
 * database, the audit log, or the n8n pipeline.
 */
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { getUserByToken } from "./lib/auth";
import { OTP_CONFIG, type OtpPurpose } from "./lib/constants";
import { timingSafeEqual } from "./lib/crypto";
import { appError } from "./lib/errors";
import { firstName, transitionLoan } from "./lib/loans";
import { notify } from "./lib/notify";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { bumpStats } from "./lib/stats";
import { recomputeToolStatus } from "./lib/toolStatus";
import { vOtpPurpose } from "./validators";

function canIssue(loan: Doc<"loans">, purpose: OtpPurpose): boolean {
  if (purpose === "COLLECTION") return loan.status === "APPROVED" || loan.status === "COLLECTION_OTP_PENDING";
  return loan.status === "RETURN_VERIFICATION_PENDING";
}

export const loanForOtp = internalQuery({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    return { pickupAt: loan.pickupAt, status: loan.status, toolName: loan.toolName };
  },
});

/**
 * Store a new code hash, superseding any previous code for the same purpose.
 * `requestedBy` is null for system issuance (after approval / return
 * confirmation) or the borrower's token identifier for on-demand codes.
 */
export const storeCode = internalMutation({
  args: {
    loanId: v.id("loans"),
    purpose: vOtpPurpose,
    codeHash: v.string(),
    expiresAt: v.number(),
    requestedBy: v.union(v.null(), v.string()),
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get(args.loanId);
    if (!loan) throw appError("NOT_FOUND", "Loan not found.");

    if (args.requestedBy !== null) {
      const user = await getUserByToken(ctx, args.requestedBy);
      if (!user || user.status !== "ACTIVE") throw appError("UNAUTHENTICATED", "Please sign in to continue.");
      if (user._id === loan.ownerId) {
        throw appError("FORBIDDEN", "Codes are shown to the borrower, who reads them out to you at the hand-over.");
      }
      if (user._id !== loan.borrowerId) throw appError("NOT_FOUND", "Loan not found.");
      await enforceRateLimit(ctx, `otp:issue:${loan._id}:${args.purpose}`, RATE_LIMITS.otpIssue);
    }

    if (!canIssue(loan, args.purpose)) {
      if (args.requestedBy === null) return { ok: false as const };
      throw appError("INVALID_STATE", "A code is not needed at this stage of the loan.");
    }

    const previous = await ctx.db
      .query("otpVerifications")
      .withIndex("by_loan_purpose_status", (q) =>
        q.eq("loanId", loan._id).eq("purpose", args.purpose).eq("status", "ACTIVE"),
      )
      .collect();
    const now = Date.now();
    // A scheduled system issuance must never replace a code the borrower
    // already requested on-demand (it may be on their screen right now).
    if (args.requestedBy === null && previous.some((p) => p.expiresAt > now)) return { ok: false as const };
    for (const p of previous) await ctx.db.patch(p._id, { status: "SUPERSEDED" });

    const otpId = await ctx.db.insert("otpVerifications", {
      loanId: loan._id,
      purpose: args.purpose,
      recipientId: loan.borrowerId,
      verifierId: loan.ownerId,
      codeHash: args.codeHash,
      status: "ACTIVE",
      attempts: 0,
      maxAttempts: OTP_CONFIG.maxAttempts,
      expiresAt: args.expiresAt,
      createdAt: now,
    });

    if (args.purpose === "COLLECTION" && loan.status === "APPROVED") {
      await transitionLoan(ctx, loan, "COLLECTION_OTP_PENDING", { role: "SYSTEM" });
    }
    await writeAudit(ctx, {
      actorType: args.requestedBy === null ? "SYSTEM" : "USER",
      actorId: args.requestedBy === null ? undefined : loan.borrowerId,
      action: "otp.issued",
      resourceType: "loan",
      resourceId: loan._id,
      meta: { purpose: args.purpose, recordId: otpId, onDemand: args.requestedBy !== null },
    });

    const [borrower, owner] = await Promise.all([ctx.db.get(loan.borrowerId), ctx.db.get(loan.ownerId)]);
    if (args.requestedBy === null) {
      await notify(ctx, {
        userId: loan.borrowerId,
        type: args.purpose === "COLLECTION" ? "PICKUP_OTP_GENERATED" : "RETURN_OTP_GENERATED",
        title: args.purpose === "COLLECTION" ? "Your pickup code is ready" : "Your return code is ready",
        body:
          args.purpose === "COLLECTION"
            ? `Show your pickup code to ${firstName(owner)} when you collect ${loan.toolName}.`
            : `${firstName(owner)} is ready to receive ${loan.toolName}. Read your return code to them at the hand-back.`,
        path: `/loans/${loan._id}`,
        loanId: loan._id,
        toolId: loan.toolId,
      });
      if (args.purpose === "COLLECTION") {
        await notify(ctx, {
          userId: loan.ownerId,
          type: "PICKUP_OTP_GENERATED",
          title: "Pickup is ready",
          body: `${firstName(borrower)} has a pickup code for ${loan.toolName}. Ask for it at the hand-over and enter it to confirm.`,
          path: `/loans/${loan._id}`,
          loanId: loan._id,
          toolId: loan.toolId,
        });
      }
    }

    return {
      ok: true as const,
      recipient: borrower
        ? { email: borrower.email, name: firstName(borrower), isSeed: borrower.isSeed === true, userId: borrower._id }
        : null,
      ownerName: firstName(owner),
      toolName: loan.toolName,
    };
  },
});

export type ConsumeResult =
  | { ok: true; status: Doc<"loans">["status"] }
  | {
      ok: false;
      code: "OTP_INVALID" | "OTP_EXPIRED" | "OTP_LOCKED" | "OTP_MISSING";
      attemptsRemaining: number;
    };

async function completeCollection(ctx: MutationCtx, loan: Doc<"loans">, ownerId: Doc<"users">["_id"]) {
  const now = Date.now();
  const collected = await transitionLoan(ctx, loan, "COLLECTED", { role: "OWNER", userId: ownerId }, { collectedAt: now });
  const active = await transitionLoan(ctx, collected, "ACTIVE_LOAN", { role: "SYSTEM" });
  await bumpStats(ctx, loan.borrowerId, { borrowingTotal: 1 });
  await bumpStats(ctx, loan.ownerId, { lendingTotal: 1 });
  await recomputeToolStatus(ctx, loan.toolId);
  const owner = await ctx.db.get(ownerId);
  await notify(ctx, {
    userId: loan.borrowerId,
    type: "PICKUP_CONFIRMED",
    title: "Pickup confirmed",
    body: `${firstName(owner)} confirmed the hand-over of ${loan.toolName}. Enjoy, and return it on time.`,
    path: `/loans/${loan._id}`,
    loanId: loan._id,
    toolId: loan.toolId,
    toolName: loan.toolName,
    status: "ACTIVE_LOAN",
  });
  return active.status;
}

async function completeReturn(ctx: MutationCtx, loan: Doc<"loans">, ownerId: Doc<"users">["_id"]) {
  const now = Date.now();
  const returned = await transitionLoan(ctx, loan, "RETURNED", { role: "OWNER", userId: ownerId }, { returnedAt: now });
  const done = await transitionLoan(ctx, returned, "COMPLETED", { role: "SYSTEM" }, { completedAt: now });
  await bumpStats(ctx, loan.borrowerId, { borrowingCompleted: 1, lateReturns: loan.lateReturn ? 1 : 0 });
  await bumpStats(ctx, loan.ownerId, { lendingCompleted: 1 });
  await recomputeToolStatus(ctx, loan.toolId);
  const owner = await ctx.db.get(ownerId);
  await notify(ctx, {
    userId: loan.borrowerId,
    type: "ITEM_RETURNED",
    title: "Return confirmed",
    body: `${firstName(owner)} confirmed ${loan.toolName} is back. Leave feedback to help the community.`,
    path: `/loans/${loan._id}`,
    loanId: loan._id,
    toolId: loan.toolId,
    toolName: loan.toolName,
    status: "COMPLETED",
  });
  await notify(ctx, {
    userId: loan.ownerId,
    type: "ITEM_RETURNED",
    title: "Loan completed",
    body: `The loan of ${loan.toolName} is complete. Leave feedback for the borrower.`,
    path: `/loans/${loan._id}`,
    loanId: loan._id,
    toolId: loan.toolId,
  });
  return done.status;
}

/**
 * Verify a submitted code and apply the hand-over transition atomically.
 * Wrong codes return (rather than throw) so the attempt counter is committed.
 */
export const consumeCode = internalMutation({
  args: {
    loanId: v.id("loans"),
    purpose: vOtpPurpose,
    codeHash: v.string(),
    tokenIdentifier: v.string(),
  },
  handler: async (ctx, args): Promise<ConsumeResult> => {
    const user = await getUserByToken(ctx, args.tokenIdentifier);
    if (!user) throw appError("UNAUTHENTICATED", "Please sign in to continue.");
    if (user.status !== "ACTIVE") throw appError("ACCOUNT_SUSPENDED", "Your account is suspended.");
    const loan = await ctx.db.get(args.loanId);
    if (!loan || (loan.ownerId !== user._id && loan.borrowerId !== user._id)) throw appError("NOT_FOUND", "Loan not found.");
    if (loan.ownerId !== user._id) {
      throw appError("FORBIDDEN", "Only the owner can confirm a hand-over. Read your code to the owner instead.");
    }
    await enforceRateLimit(ctx, `otp:verify:${user._id}`, RATE_LIMITS.otpVerify);

    const expected = args.purpose === "COLLECTION" ? "COLLECTION_OTP_PENDING" : "RETURN_VERIFICATION_PENDING";
    if (loan.status !== expected) {
      if (args.purpose === "COLLECTION" && loan.status === "APPROVED") {
        return { ok: false, code: "OTP_MISSING", attemptsRemaining: 0 };
      }
      throw appError("INVALID_STATE", "This hand-over has already been confirmed or is no longer pending.");
    }

    const otp = await ctx.db
      .query("otpVerifications")
      .withIndex("by_loan_purpose_status", (q) =>
        q.eq("loanId", loan._id).eq("purpose", args.purpose).eq("status", "ACTIVE"),
      )
      .order("desc")
      .first();
    if (!otp) {
      const locked = await ctx.db
        .query("otpVerifications")
        .withIndex("by_loan_purpose_status", (q) =>
          q.eq("loanId", loan._id).eq("purpose", args.purpose).eq("status", "LOCKED"),
        )
        .first();
      return { ok: false, code: locked ? "OTP_LOCKED" : "OTP_MISSING", attemptsRemaining: 0 };
    }
    const now = Date.now();
    if (otp.expiresAt <= now) return { ok: false, code: "OTP_EXPIRED", attemptsRemaining: 0 };

    if (!timingSafeEqual(otp.codeHash, args.codeHash)) {
      const attempts = otp.attempts + 1;
      const locked = attempts >= otp.maxAttempts;
      await ctx.db.patch(otp._id, { attempts, status: locked ? "LOCKED" : "ACTIVE" });
      await writeAudit(ctx, {
        actorId: user._id,
        actorType: "USER",
        action: locked ? "otp.locked" : "otp.failed_attempt",
        resourceType: "loan",
        resourceId: loan._id,
        meta: { purpose: args.purpose, attempts },
      });
      return { ok: false, code: locked ? "OTP_LOCKED" : "OTP_INVALID", attemptsRemaining: otp.maxAttempts - attempts };
    }

    await ctx.db.patch(otp._id, { status: "CONSUMED", consumedAt: now });
    await writeAudit(ctx, {
      actorId: user._id,
      actorType: "USER",
      action: "otp.verified",
      resourceType: "loan",
      resourceId: loan._id,
      meta: { purpose: args.purpose },
    });
    const status =
      args.purpose === "COLLECTION" ? await completeCollection(ctx, loan, user._id) : await completeReturn(ctx, loan, user._id);
    return { ok: true, status };
  },
});
