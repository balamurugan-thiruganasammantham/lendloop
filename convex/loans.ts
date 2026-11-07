import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { claimImages } from "./files";
import { writeAudit } from "./lib/audit";
import { getViewer, loanRoleOf, requireActiveViewer, type LoanRole } from "./lib/auth";
import { LIMITS, type LoanStatus } from "./lib/constants";
import { appError, invalid, notFound } from "./lib/errors";
import { firstName, supersedeOtps, transitionLoan } from "./lib/loans";
import { notify } from "./lib/notify";
import { imageUrls, toolCard, userLoader, userSummary } from "./lib/projections";
import { computeReputation, isLateReturn } from "./lib/rules";
import { isTerminalLoanStatus, TERMINAL_LOAN_STATUSES } from "./lib/stateMachine";
import { bumpStats } from "./lib/stats";
import { recomputeToolStatus } from "./lib/toolStatus";

const NON_TERMINAL: readonly LoanStatus[] = [
  "APPROVED",
  "COLLECTION_OTP_PENDING",
  "COLLECTED",
  "ACTIVE_LOAN",
  "OVERDUE",
  "RETURN_REQUESTED",
  "RETURN_VERIFICATION_PENDING",
  "RETURNED",
  "DAMAGE_REPORTED",
  "DISPUTED",
];

/** Statuses in which the borrower may see the exact pickup/return point. */
const LOCATION_VISIBLE: readonly LoanStatus[] = NON_TERMINAL;

export type LoanAction =
  | "CANCEL"
  | "GET_PICKUP_CODE"
  | "VERIFY_PICKUP"
  | "REQUEST_RETURN"
  | "CONFIRM_RETURN"
  | "GET_RETURN_CODE"
  | "VERIFY_RETURN"
  | "REPORT_DAMAGE"
  | "RESPOND_DAMAGE"
  | "REPORT_NOT_RETURNED"
  | "SET_RETURN_ARRANGEMENT"
  | "LEAVE_FEEDBACK";

/** Actions the viewer may take. The mutations enforce the same rules. */
export function allowedLoanActions(
  loan: Pick<Doc<"loans">, "status" | "returnBy">,
  role: LoanRole,
  opts: { now: number; hasOpenDamageReport: boolean; feedbackGiven: boolean },
): LoanAction[] {
  const s = loan.status;
  const actions: LoanAction[] = [];
  if (role === "BORROWER") {
    if (s === "APPROVED" || s === "COLLECTION_OTP_PENDING") actions.push("CANCEL", "GET_PICKUP_CODE");
    if (s === "ACTIVE_LOAN" || s === "OVERDUE") actions.push("REQUEST_RETURN");
    if (s === "RETURN_VERIFICATION_PENDING") actions.push("GET_RETURN_CODE");
    if (s === "DAMAGE_REPORTED" && opts.hasOpenDamageReport) actions.push("RESPOND_DAMAGE");
  }
  if (role === "OWNER") {
    if (s === "APPROVED" || s === "COLLECTION_OTP_PENDING") actions.push("CANCEL", "VERIFY_PICKUP");
    if (s === "RETURN_REQUESTED" || s === "DAMAGE_REPORTED" || s === "DISPUTED") actions.push("CONFIRM_RETURN");
    if (s === "RETURN_VERIFICATION_PENDING") actions.push("VERIFY_RETURN");
    if (s === "RETURN_REQUESTED" || s === "RETURN_VERIFICATION_PENDING") actions.push("REPORT_DAMAGE");
    if (s === "OVERDUE" || s === "RETURN_REQUESTED" || s === "RETURN_VERIFICATION_PENDING" || (s === "ACTIVE_LOAN" && opts.now > loan.returnBy)) {
      actions.push("REPORT_NOT_RETURNED");
    }
    if (!isTerminalLoanStatus(s)) actions.push("SET_RETURN_ARRANGEMENT");
  }
  if ((role === "BORROWER" || role === "OWNER") && s === "COMPLETED" && !opts.feedbackGiven) {
    actions.push("LEAVE_FEEDBACK");
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const get = query({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    let role: LoanRole;
    try {
      role = loanRoleOf(viewer, loan);
    } catch {
      return null; // Indistinguishable from "not found" to avoid leaking existence.
    }
    const now = Date.now();
    const [tool, owner, borrower] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(loan.ownerId), ctx.db.get(loan.borrowerId)]);

    // Exact location: only for the two participants (and admins) while the loan is live.
    let pickup: { lat: number; lng: number; address: string | null } | null = null;
    if (LOCATION_VISIBLE.includes(loan.status)) {
      const loc = await ctx.db
        .query("toolPickupLocations")
        .withIndex("by_tool", (q) => q.eq("toolId", loan.toolId))
        .unique();
      if (loc) pickup = { lat: loc.lat, lng: loc.lng, address: loc.address ?? null };
    }

    const otps = await ctx.db
      .query("otpVerifications")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .filter((q) => q.eq(q.field("status"), "ACTIVE"))
      .collect();
    const otpState = (purpose: "COLLECTION" | "RETURN") => {
      const otp = otps.find((o) => o.purpose === purpose);
      if (!otp) return null;
      return {
        expiresAt: otp.expiresAt,
        expired: otp.expiresAt <= now,
        attemptsRemaining: Math.max(0, otp.maxAttempts - otp.attempts),
      };
    };

    const submission = await ctx.db
      .query("returnSubmissions")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .order("desc")
      .first();
    const damage = await ctx.db
      .query("damageReports")
      .withIndex("by_loan", (q) => q.eq("loanId", loanId))
      .order("desc")
      .collect();
    const feedback = await ctx.db
      .query("feedback")
      .withIndex("by_loan_author", (q) => q.eq("loanId", loanId))
      .collect();
    const mine = feedback.find((f) => f.authorId === viewer._id) ?? null;
    const theirs = feedback.find((f) => f.authorId !== viewer._id && f.status !== "HIDDEN") ?? null;

    const timeline = await ctx.db
      .query("auditLogs")
      .withIndex("by_resource", (q) => q.eq("resourceType", "loan").eq("resourceId", loanId))
      .order("asc")
      .take(100);

    const hasOpenDamageReport = damage.some((d) => d.status === "OPEN");
    return {
      id: loan._id,
      role,
      status: loan.status,
      pickupAt: loan.pickupAt,
      returnBy: loan.returnBy,
      createdAt: loan.createdAt,
      updatedAt: loan.updatedAt,
      collectedAt: loan.collectedAt ?? null,
      returnRequestedAt: loan.returnRequestedAt ?? null,
      returnedAt: loan.returnedAt ?? null,
      completedAt: loan.completedAt ?? null,
      cancelledAt: loan.cancelledAt ?? null,
      cancelReason: loan.cancelReason ?? null,
      wasOverdue: loan.wasOverdue,
      lateReturn: loan.lateReturn ?? null,
      disputeReason: loan.disputeReason ?? null,
      disputeOutcome: loan.disputeOutcome ?? null,
      disputeResolutionNote: loan.disputeResolutionNote ?? null,
      returnArrangement: loan.returnArrangement ?? null,
      tool: {
        id: loan.toolId,
        name: loan.toolName,
        category: loan.toolCategory,
        condition: tool?.condition ?? null,
        pickupArea: tool?.pickupArea ?? null,
        approxLat: tool?.approxLat ?? null,
        approxLng: tool?.approxLng ?? null,
        images: tool ? await imageUrls(ctx, tool.imageIds) : [],
        instructions: tool?.instructions ?? null,
        lendingTerms: tool?.lendingTerms ?? null,
        removed: !tool || tool.removedAt !== undefined,
      },
      owner: owner ? userSummary(owner) : null,
      borrower: borrower
        ? {
            ...userSummary(borrower),
            reputation: role !== "BORROWER" ? computeReputation(borrower.stats, borrower.createdAt, now) : null,
          }
        : null,
      pickup,
      otp: { collection: otpState("COLLECTION"), return: otpState("RETURN") },
      returnSubmission: submission
        ? {
            photos: await imageUrls(ctx, submission.photoIds),
            notes: submission.notes ?? null,
            submittedAt: submission.submittedAt,
          }
        : null,
      damageReports: await Promise.all(
        damage.map(async (d) => ({
          id: d._id,
          description: d.description,
          evidence: await imageUrls(ctx, d.evidenceIds),
          status: d.status,
          borrowerResponse: d.borrowerResponse ?? null,
          resolutionNote: d.resolutionNote ?? null,
          createdAt: d.createdAt,
        })),
      ),
      feedback: {
        mine: mine ? { rating: mine.rating, comment: mine.comment ?? null, tags: mine.tags, createdAt: mine.createdAt } : null,
        theirs: theirs ? { id: theirs._id, rating: theirs.rating, comment: theirs.comment ?? null, tags: theirs.tags, createdAt: theirs.createdAt } : null,
      },
      timeline: timeline.map((e) => ({
        id: e._id,
        action: e.action,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        actor: e.actorType !== "USER" ? e.actorType : e.actorId === loan.borrowerId ? "BORROWER" : e.actorId === loan.ownerId ? "OWNER" : "USER",
        at: e.createdAt,
      })),
      actions: allowedLoanActions(loan, role, { now, hasOpenDamageReport, feedbackGiven: mine !== null }),
    };
  },
});

async function loanRows(ctx: QueryCtx, loans: Doc<"loans">[], viewerId: Doc<"users">["_id"]) {
  const loadUser = userLoader(ctx);
  return Promise.all(
    loans.map(async (loan) => {
      const tool = await ctx.db.get(loan.toolId);
      const counterpartId = loan.borrowerId === viewerId ? loan.ownerId : loan.borrowerId;
      const counterpart = await loadUser(counterpartId);
      const feedbackGiven =
        loan.status === "COMPLETED"
          ? (await ctx.db
              .query("feedback")
              .withIndex("by_loan_author", (q) => q.eq("loanId", loan._id).eq("authorId", viewerId))
              .first()) !== null
          : false;
      return {
        id: loan._id,
        role: loan.borrowerId === viewerId ? ("BORROWER" as const) : ("OWNER" as const),
        status: loan.status,
        pickupAt: loan.pickupAt,
        returnBy: loan.returnBy,
        updatedAt: loan.updatedAt,
        completedAt: loan.completedAt ?? null,
        cancelledAt: loan.cancelledAt ?? null,
        wasOverdue: loan.wasOverdue,
        lateReturn: loan.lateReturn ?? null,
        disputeOutcome: loan.disputeOutcome ?? null,
        feedbackGiven,
        tool: tool
          ? { ...(await toolCard(ctx, tool)), name: loan.toolName }
          : { id: loan.toolId, name: loan.toolName, category: loan.toolCategory, imageUrl: null },
        counterpart: counterpart ? userSummary(counterpart) : null,
      };
    }),
  );
}

async function viewerLoans(ctx: QueryCtx, viewerId: Doc<"users">["_id"], statuses: readonly LoanStatus[], perStatus: number) {
  const lists = await Promise.all(
    statuses.flatMap((status) => [
      ctx.db
        .query("loans")
        .withIndex("by_borrower_status", (q) => q.eq("borrowerId", viewerId).eq("status", status))
        .order("desc")
        .take(perStatus),
      ctx.db
        .query("loans")
        .withIndex("by_owner_status", (q) => q.eq("ownerId", viewerId).eq("status", status))
        .order("desc")
        .take(perStatus),
    ]),
  );
  return lists.flat().sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Live loans where the viewer is borrower or owner. */
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    return loanRows(ctx, await viewerLoans(ctx, viewer._id, NON_TERMINAL, 50), viewer._id);
  },
});

/** Completed and cancelled loans. */
export const history = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    return loanRows(ctx, await viewerLoans(ctx, viewer._id, TERMINAL_LOAN_STATUSES, 100), viewer._id);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const cancel = mutation({
  args: { loanId: v.id("loans"), reason: v.optional(v.string()) },
  handler: async (ctx, { loanId, reason }) => {
    const viewer = await requireActiveViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw notFound("Loan");
    const role = loanRoleOf(viewer, loan, false);
    const cleanReason = reason?.trim() ?? "";
    if (cleanReason.length > LIMITS.reasonMax) throw invalid("Reason is too long.");
    const now = Date.now();
    await transitionLoan(
      ctx,
      loan,
      "CANCELLED",
      { role, userId: viewer._id },
      { cancelledAt: now, cancelReason: cleanReason || `Cancelled by ${role === "OWNER" ? "owner" : "borrower"}` },
    );
    await supersedeOtps(ctx, loanId);
    await recomputeToolStatus(ctx, loan.toolId);
    const otherId = role === "OWNER" ? loan.borrowerId : loan.ownerId;
    await notify(ctx, {
      userId: otherId,
      type: "LOAN_CANCELLED",
      title: "Loan cancelled",
      body: `${firstName(viewer)} cancelled the loan of ${loan.toolName} before pickup.${cleanReason ? ` Reason: “${cleanReason}”` : ""}`,
      path: `/loans/${loanId}`,
      loanId,
      toolId: loan.toolId,
      toolName: loan.toolName,
      status: "CANCELLED",
    });
    return null;
  },
});

/** Borrower starts the hand-back with a current photo of the tool. */
export const requestReturn = mutation({
  args: {
    loanId: v.id("loans"),
    photoIds: v.array(v.id("_storage")),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, { loanId, photoIds, notes }) => {
    const viewer = await requireActiveViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan || loan.borrowerId !== viewer._id) throw notFound("Loan");
    const cleanNotes = notes?.trim() ?? "";
    if (cleanNotes.length > LIMITS.messageMax) throw invalid(`Notes must be at most ${LIMITS.messageMax} characters.`);
    await claimImages(ctx, viewer._id, photoIds, { min: 1, max: LIMITS.returnPhotosMax });
    const now = Date.now();
    await transitionLoan(
      ctx,
      loan,
      "RETURN_REQUESTED",
      { role: "BORROWER", userId: viewer._id },
      { returnRequestedAt: now, lateReturn: isLateReturn(loan.returnBy, now) },
    );
    await ctx.db.insert("returnSubmissions", {
      loanId,
      borrowerId: viewer._id,
      photoIds,
      notes: cleanNotes || undefined,
      submittedAt: now,
    });
    await recomputeToolStatus(ctx, loan.toolId);
    await notify(ctx, {
      userId: loan.ownerId,
      type: "RETURN_REQUESTED",
      title: "Ready to return",
      body: `${firstName(viewer)} is ready to return your ${loan.toolName}.`,
      path: `/loans/${loanId}`,
      loanId,
      toolId: loan.toolId,
      toolName: loan.toolName,
      status: "RETURN_REQUESTED",
    });
    return null;
  },
});

/**
 * Owner confirms they are receiving the tool. Moves to verification and
 * generates a return code for the borrower to read out at the hand-back.
 */
export const confirmReturnReady = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await requireActiveViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan || loan.ownerId !== viewer._id) throw notFound("Loan");
    await transitionLoan(ctx, loan, "RETURN_VERIFICATION_PENDING", { role: "OWNER", userId: viewer._id });
    await recomputeToolStatus(ctx, loan.toolId);
    await ctx.scheduler.runAfter(0, internal.otpActions.issueSystemCode, { loanId, purpose: "RETURN" });
    return null;
  },
});

export const reportDamage = mutation({
  args: {
    loanId: v.id("loans"),
    description: v.string(),
    evidenceIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, { loanId, description, evidenceIds }) => {
    const viewer = await requireActiveViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan || loan.ownerId !== viewer._id) throw notFound("Loan");
    const text = description.trim();
    if (text.length < LIMITS.damageDescriptionMin || text.length > LIMITS.damageDescriptionMax) {
      throw invalid(`Describe the damage in ${LIMITS.damageDescriptionMin}–${LIMITS.damageDescriptionMax} characters.`);
    }
    await claimImages(ctx, viewer._id, evidenceIds, { min: 1, max: LIMITS.evidenceMax });
    await transitionLoan(ctx, loan, "DAMAGE_REPORTED", { role: "OWNER", userId: viewer._id });
    await supersedeOtps(ctx, loanId, "RETURN");
    const now = Date.now();
    const reportId = await ctx.db.insert("damageReports", {
      loanId,
      toolId: loan.toolId,
      reporterId: viewer._id,
      subjectId: loan.borrowerId,
      description: text,
      evidenceIds,
      status: "OPEN",
      createdAt: now,
      updatedAt: now,
    });
    await bumpStats(ctx, loan.borrowerId, { damageReportsReceived: 1 });
    await writeAudit(ctx, {
      actorId: viewer._id,
      actorType: "USER",
      action: "damage.reported",
      resourceType: "damageReport",
      resourceId: reportId,
      toStatus: "OPEN",
      meta: { loanId },
    });
    await recomputeToolStatus(ctx, loan.toolId);
    await notify(ctx, {
      userId: loan.borrowerId,
      type: "DAMAGE_REPORTED",
      title: "Damage reported",
      body: `${firstName(viewer)} reported damage to ${loan.toolName}. Review the report and respond.`,
      path: `/loans/${loanId}`,
      loanId,
      toolId: loan.toolId,
      toolName: loan.toolName,
      status: "DAMAGE_REPORTED",
    });
    return reportId;
  },
});

/** Borrower acknowledges or contests a damage report. Contesting opens a dispute. */
export const respondToDamage = mutation({
  args: {
    reportId: v.id("damageReports"),
    response: v.union(v.literal("ACKNOWLEDGE"), v.literal("CONTEST")),
    statement: v.optional(v.string()),
  },
  handler: async (ctx, { reportId, response, statement }) => {
    const viewer = await requireActiveViewer(ctx);
    const report = await ctx.db.get(reportId);
    if (!report || report.subjectId !== viewer._id) throw notFound("Damage report");
    if (report.status !== "OPEN") throw appError("INVALID_STATE", "You have already responded to this report.");
    const loan = await ctx.db.get(report.loanId);
    if (!loan) throw notFound("Loan");
    const text = statement?.trim() ?? "";
    if (text.length > LIMITS.reasonMax) throw invalid("Statement is too long.");
    if (response === "CONTEST" && text.length < 10) throw invalid("Please explain why you disagree (at least 10 characters).");

    const nextStatus = response === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : "CONTESTED";
    await ctx.db.patch(reportId, { status: nextStatus, borrowerResponse: text || undefined, updatedAt: Date.now() });
    if (response === "ACKNOWLEDGE") {
      await bumpStats(ctx, viewer._id, { damageReportsVerified: 1 });
    } else if (loan.status === "DAMAGE_REPORTED") {
      await transitionLoan(ctx, loan, "DISPUTED", { role: "BORROWER", userId: viewer._id }, { disputeReason: "Damage report contested" });
      await recomputeToolStatus(ctx, loan.toolId);
    }
    await writeAudit(ctx, {
      actorId: viewer._id,
      actorType: "USER",
      action: response === "ACKNOWLEDGE" ? "damage.acknowledged" : "damage.contested",
      resourceType: "damageReport",
      resourceId: reportId,
      fromStatus: "OPEN",
      toStatus: nextStatus,
    });
    await notify(ctx, {
      userId: loan.ownerId,
      type: "DAMAGE_RESPONSE",
      title: response === "ACKNOWLEDGE" ? "Damage acknowledged" : "Damage report contested",
      body:
        response === "ACKNOWLEDGE"
          ? `${firstName(viewer)} acknowledged the damage to ${loan.toolName}. You can now confirm the return.`
          : `${firstName(viewer)} contested the damage report for ${loan.toolName}. An admin will review it.`,
      path: `/loans/${loan._id}`,
      loanId: loan._id,
      toolId: loan.toolId,
    });
    return null;
  },
});

export const reportNotReturned = mutation({
  args: { loanId: v.id("loans"), details: v.string() },
  handler: async (ctx, { loanId, details }) => {
    const viewer = await requireActiveViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan || loan.ownerId !== viewer._id) throw notFound("Loan");
    const text = details.trim();
    if (text.length < 10 || text.length > LIMITS.reasonMax) throw invalid("Describe what happened in 10–500 characters.");
    const now = Date.now();
    if (loan.status === "ACTIVE_LOAN" && now <= loan.returnBy) {
      throw appError("INVALID_STATE", "You can report a missing return once the agreed return time has passed.");
    }
    await transitionLoan(ctx, loan, "DISPUTED", { role: "OWNER", userId: viewer._id }, { disputeReason: text }, { kind: "not_returned" });
    await supersedeOtps(ctx, loanId);
    await bumpStats(ctx, loan.borrowerId, { notReturnedReports: 1 });
    await recomputeToolStatus(ctx, loan.toolId);
    await notify(ctx, {
      userId: loan.borrowerId,
      type: "NOT_RETURNED_REPORTED",
      title: "Return disputed",
      body: `${firstName(viewer)} reported that ${loan.toolName} has not been returned. An admin will review the case.`,
      path: `/loans/${loanId}`,
      loanId,
      toolId: loan.toolId,
      toolName: loan.toolName,
      status: "DISPUTED",
    });
    return null;
  },
});

export const setReturnArrangement = mutation({
  args: { loanId: v.id("loans"), note: v.string() },
  handler: async (ctx, { loanId, note }) => {
    const viewer = await requireActiveViewer(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan || loan.ownerId !== viewer._id) throw notFound("Loan");
    if (isTerminalLoanStatus(loan.status)) throw appError("INVALID_STATE", "This loan is closed.");
    const text = note.trim();
    if (text.length > LIMITS.instructionsMax) throw invalid("Note is too long.");
    await ctx.db.patch(loanId, { returnArrangement: text || undefined, updatedAt: Date.now() });
    await writeAudit(ctx, {
      actorId: viewer._id,
      actorType: "USER",
      action: "loan.return_arrangement_updated",
      resourceType: "loan",
      resourceId: loanId,
    });
    return null;
  },
});

/** Count for navigation badges. */
export const activeCount = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return 0;
    return (await viewerLoans(ctx, viewer._id, NON_TERMINAL, 20)).length;
  },
});

/**
 * Recent automation for one loan (n8n notification deliveries and overdue reminders), shown on
 * the loan page. Same access rule as `get`: the loan's owner, its borrower, or an admin; anyone
 * else gets null. Returns delivery facts only: no email addresses, payloads or error text.
 */
export const automationActivity = query({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return null;
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    try {
      loanRoleOf(viewer, loan);
    } catch {
      return null;
    }
    const [byLoan, byRequest, reminders] = await Promise.all([
      ctx.db
        .query("automationEvents")
        .withIndex("by_loan", (q) => q.eq("loanId", loanId))
        .order("desc")
        .take(30),
      ctx.db
        .query("automationEvents")
        .withIndex("by_request", (q) => q.eq("requestId", loan.requestId))
        .order("desc")
        .take(30),
      ctx.db
        .query("automationReminders")
        .withIndex("by_loan", (q) => q.eq("loanId", loanId))
        .order("desc")
        .take(30),
    ]);
    const seen = new Set<string>();
    const events = [...byLoan, ...byRequest].filter((e) => (seen.has(e._id) ? false : (seen.add(e._id), true)));
    const items = [
      ...events.map((e) => ({
        kind: "notification" as const,
        id: e._id as string,
        eventType: e.eventType,
        recipient: e.recipientId === loan.ownerId ? ("OWNER" as const) : e.recipientId === loan.borrowerId ? ("BORROWER" as const) : ("OTHER" as const),
        status: e.status,
        result: e.deliveryResult ?? null,
        attempts: e.attempts,
        at: e.deliveryReportedAt ?? e.deliveredAt ?? e.lastAttemptAt ?? e.createdAt,
      })),
      ...reminders.map((r) => ({
        kind: "reminder" as const,
        id: r._id as string,
        period: r.period,
        status: r.status,
        attempts: r.attempts,
        at: r.completedAt ?? r.claimedAt,
      })),
    ];
    return items.sort((a, b) => b.at - a.at).slice(0, 20);
  },
});
