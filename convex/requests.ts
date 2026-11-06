import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { getViewer, requireActiveViewer } from "./lib/auth";
import { LIMITS, type LoanStatus } from "./lib/constants";
import { appError, invalid, notFound } from "./lib/errors";
import { notify } from "./lib/notify";
import { toolCard, userLoader, userSummary } from "./lib/projections";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { computeReputation, findConflict, rangesOverlap, validateBorrowWindow } from "./lib/rules";
import { assertRequestTransition, borrowerTabFor, TransitionError } from "./lib/stateMachine";
import { openLoansForTool, recomputeToolStatus } from "./lib/toolStatus";
import { vRequestStatus } from "./validators";

function formatRange(pickupAt: number, returnBy: number): string {
  const fmt = (ms: number) =>
    new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(pickupAt)} – ${fmt(returnBy)}`;
}

function firstName(user: Doc<"users">): string {
  return user.name.trim().split(/\s+/)[0] ?? "A neighbour";
}

function transition(from: Doc<"borrowRequests">["status"], to: Doc<"borrowRequests">["status"], actor: "BORROWER" | "OWNER" | "SYSTEM" | "ADMIN") {
  try {
    assertRequestTransition(from, to, actor);
  } catch (e) {
    if (e instanceof TransitionError) {
      throw appError("INVALID_STATE", from === "PENDING" ? "This action is not allowed." : "This request has already been processed.");
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
  args: {
    toolId: v.id("tools"),
    pickupAt: v.number(),
    returnBy: v.number(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const borrower = await requireActiveViewer(ctx);
    await enforceRateLimit(ctx, `request:create:${borrower._id}`, RATE_LIMITS.createRequest);

    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.removedAt !== undefined) throw notFound("Listing");
    if (tool.ownerId === borrower._id) throw appError("FORBIDDEN", "You cannot borrow your own tool.");
    if (!tool.discoverable) throw appError("UNAVAILABLE", "This tool is not available for new requests right now.");
    const owner = await ctx.db.get(tool.ownerId);
    if (!owner || owner.status !== "ACTIVE") throw appError("UNAVAILABLE", "This tool is not available right now.");

    const now = Date.now();
    const window = validateBorrowWindow({
      pickupAt: args.pickupAt,
      returnBy: args.returnBy,
      now,
      maxLoanDays: tool.maxLoanDays,
      availableFrom: tool.availableFrom,
      availableUntil: tool.availableUntil,
    });
    if (!window.ok) throw invalid(window.message, { reason: window.code });

    const message = args.message?.trim() ?? "";
    if (message.length > LIMITS.messageMax) throw invalid(`Message must be at most ${LIMITS.messageMax} characters.`);

    const duplicate = await ctx.db
      .query("borrowRequests")
      .withIndex("by_borrower_tool_status", (q) =>
        q.eq("borrowerId", borrower._id).eq("toolId", tool._id).eq("status", "PENDING"),
      )
      .first();
    if (duplicate) throw appError("DUPLICATE", "You already have a pending request for this tool.");

    const open = await openLoansForTool(ctx, tool._id);
    if (open.some((l) => l.borrowerId === borrower._id)) {
      throw appError("DUPLICATE", "You already have an approved or active loan for this tool.");
    }
    const conflict = findConflict({ pickupAt: args.pickupAt, returnBy: args.returnBy }, open);
    if (conflict) throw appError("CONFLICT", "Those dates overlap an existing reservation. Please choose other dates.");

    const requestId = await ctx.db.insert("borrowRequests", {
      toolId: tool._id,
      ownerId: tool.ownerId,
      borrowerId: borrower._id,
      pickupAt: args.pickupAt,
      returnBy: args.returnBy,
      message: message || undefined,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
    });
    await recomputeToolStatus(ctx, tool._id);
    await writeAudit(ctx, {
      actorId: borrower._id,
      actorType: "USER",
      action: "request.created",
      resourceType: "request",
      resourceId: requestId,
      toStatus: "PENDING",
      meta: { toolId: tool._id },
    });
    await notify(ctx, {
      userId: tool.ownerId,
      type: "REQUEST_CREATED",
      title: "New borrow request",
      body: `${firstName(borrower)} wants to borrow your ${tool.name} (${formatRange(args.pickupAt, args.returnBy)}).`,
      path: "/incoming",
      requestId,
      toolId: tool._id,
      toolName: tool.name,
      status: "PENDING",
    });
    return requestId;
  },
});

export const cancel = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: async (ctx, { requestId }) => {
    const viewer = await requireActiveViewer(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.borrowerId !== viewer._id) throw notFound("Request");
    transition(request.status, "CANCELLED", "BORROWER");
    const now = Date.now();
    await ctx.db.patch(requestId, { status: "CANCELLED", decidedAt: now, updatedAt: now });
    await recomputeToolStatus(ctx, request.toolId);
    await writeAudit(ctx, {
      actorId: viewer._id,
      actorType: "USER",
      action: "request.cancelled",
      resourceType: "request",
      resourceId: requestId,
      fromStatus: "PENDING",
      toStatus: "CANCELLED",
    });
    const tool = await ctx.db.get(request.toolId);
    await notify(ctx, {
      userId: request.ownerId,
      type: "REQUEST_CANCELLED",
      title: "Request withdrawn",
      body: `${firstName(viewer)} withdrew their request for ${tool?.name ?? "your tool"}.`,
      path: "/incoming",
      requestId,
      toolId: request.toolId,
      toolName: tool?.name,
      status: "CANCELLED",
    });
    return null;
  },
});

/**
 * Approve a pending request. Runs as a single serialisable transaction:
 * ownership, request state, borrower state, listing state and calendar
 * conflicts are all re-checked here, so two concurrent approvals for
 * overlapping dates cannot both succeed.
 */
export const approve = mutation({
  args: { requestId: v.id("borrowRequests") },
  handler: async (ctx, { requestId }) => {
    const owner = await requireActiveViewer(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.ownerId !== owner._id) throw notFound("Request");
    transition(request.status, "APPROVED", "OWNER");

    const tool = await ctx.db.get(request.toolId);
    if (!tool || tool.removedAt !== undefined || tool.ownerId !== owner._id) {
      throw appError("INVALID_STATE", "This listing no longer exists.");
    }
    if (!tool.isListed) throw appError("INVALID_STATE", "Re-enable the listing before approving requests.");
    const borrower = await ctx.db.get(request.borrowerId);
    if (!borrower || borrower.status !== "ACTIVE") {
      throw appError("INVALID_STATE", "The borrower's account is not active. This request cannot be approved.");
    }
    const now = Date.now();
    if (request.returnBy <= now) throw appError("INVALID_STATE", "The requested dates have already passed.");

    const open = await openLoansForTool(ctx, tool._id);
    if (findConflict(request, open)) {
      throw appError("CONFLICT", "These dates now overlap another approved loan.");
    }

    const loanId = await ctx.db.insert("loans", {
      requestId,
      toolId: tool._id,
      ownerId: owner._id,
      borrowerId: borrower._id,
      status: "APPROVED",
      pickupAt: request.pickupAt,
      returnBy: request.returnBy,
      toolName: tool.name,
      toolCategory: tool.category,
      wasOverdue: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(requestId, { status: "APPROVED", loanId, decidedAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId: owner._id,
      actorType: "USER",
      action: "request.approved",
      resourceType: "request",
      resourceId: requestId,
      fromStatus: "PENDING",
      toStatus: "APPROVED",
      meta: { loanId },
    });
    await writeAudit(ctx, {
      actorId: owner._id,
      actorType: "USER",
      action: "loan.created",
      resourceType: "loan",
      resourceId: loanId,
      toStatus: "APPROVED",
    });

    // Other pending requests whose dates collide can no longer be honoured.
    const pending = await ctx.db
      .query("borrowRequests")
      .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "PENDING"))
      .collect();
    for (const other of pending) {
      if (!rangesOverlap(other.pickupAt, other.returnBy, request.pickupAt, request.returnBy)) continue;
      await ctx.db.patch(other._id, {
        status: "DECLINED",
        declineReason: "Those dates were booked by another neighbour.",
        decidedAt: now,
        updatedAt: now,
      });
      await writeAudit(ctx, {
        actorType: "SYSTEM",
        action: "request.declined",
        resourceType: "request",
        resourceId: other._id,
        fromStatus: "PENDING",
        toStatus: "DECLINED",
        meta: { reason: "date_conflict" },
      });
      await notify(ctx, {
        userId: other.borrowerId,
        type: "REQUEST_DECLINED",
        title: "Dates no longer available",
        body: `${tool.name} was booked for overlapping dates. Try another time.`,
        path: "/requests?tab=DECLINED",
        requestId: other._id,
        toolId: tool._id,
        toolName: tool.name,
        status: "DECLINED",
      });
    }

    await recomputeToolStatus(ctx, tool._id);
    await notify(ctx, {
      userId: borrower._id,
      type: "REQUEST_APPROVED",
      title: "Request approved",
      body: `${firstName(owner)} approved your request for ${tool.name}. Pickup details are now available.`,
      path: `/loans/${loanId}`,
      requestId,
      loanId,
      toolId: tool._id,
      toolName: tool.name,
      status: "APPROVED",
    });
    // Generate and deliver the collection code outside the transaction (needs secure randomness).
    await ctx.scheduler.runAfter(0, internal.otpActions.issueSystemCode, { loanId, purpose: "COLLECTION" });
    return loanId;
  },
});

export const decline = mutation({
  args: { requestId: v.id("borrowRequests"), reason: v.optional(v.string()) },
  handler: async (ctx, { requestId, reason }) => {
    const owner = await requireActiveViewer(ctx);
    const request = await ctx.db.get(requestId);
    if (!request || request.ownerId !== owner._id) throw notFound("Request");
    transition(request.status, "DECLINED", "OWNER");
    const cleanReason = reason?.trim() ?? "";
    if (cleanReason.length > LIMITS.reasonMax) throw invalid(`Reason must be at most ${LIMITS.reasonMax} characters.`);
    const now = Date.now();
    await ctx.db.patch(requestId, {
      status: "DECLINED",
      declineReason: cleanReason || undefined,
      decidedAt: now,
      updatedAt: now,
    });
    await recomputeToolStatus(ctx, request.toolId);
    await writeAudit(ctx, {
      actorId: owner._id,
      actorType: "USER",
      action: "request.declined",
      resourceType: "request",
      resourceId: requestId,
      fromStatus: "PENDING",
      toStatus: "DECLINED",
    });
    const tool = await ctx.db.get(request.toolId);
    await notify(ctx, {
      userId: request.borrowerId,
      type: "REQUEST_DECLINED",
      title: "Request declined",
      body: cleanReason
        ? `${firstName(owner)} declined your request for ${tool?.name ?? "the tool"}: “${cleanReason}”`
        : `${firstName(owner)} declined your request for ${tool?.name ?? "the tool"}.`,
      path: "/requests?tab=DECLINED",
      requestId,
      toolId: request.toolId,
      toolName: tool?.name,
      status: "DECLINED",
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function toolCardOrSnapshot(ctx: QueryCtx, toolId: Id<"tools">, loan: Doc<"loans"> | null) {
  const tool = await ctx.db.get(toolId);
  if (tool) return { ...(await toolCard(ctx, tool)), removed: tool.removedAt !== undefined };
  return {
    id: toolId,
    name: loan?.toolName ?? "Removed listing",
    category: loan?.toolCategory ?? "OTHER",
    condition: "GOOD" as const,
    status: "REMOVED" as const,
    pickupArea: "",
    approxLat: 0,
    approxLng: 0,
    imageUrl: null,
    createdAt: 0,
    isSeed: false,
    removed: true,
  };
}

/** Borrower view of all their requests, classified into the My Requests tabs. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const statuses = ["PENDING", "APPROVED", "DECLINED", "CANCELLED", "EXPIRED"] as const;
    const lists = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("borrowRequests")
          .withIndex("by_borrower_status", (q) => q.eq("borrowerId", viewer._id).eq("status", status))
          .order("desc")
          .take(100),
      ),
    );
    const requests = lists.flat().sort((a, b) => b.updatedAt - a.updatedAt);
    const loadUser = userLoader(ctx);
    return Promise.all(
      requests.map(async (r) => {
        const loan = r.loanId ? await ctx.db.get(r.loanId) : null;
        const owner = await loadUser(r.ownerId);
        const feedbackGiven = loan
          ? (await ctx.db
              .query("feedback")
              .withIndex("by_loan_author", (q) => q.eq("loanId", loan._id).eq("authorId", viewer._id))
              .first()) !== null
          : false;
        return {
          id: r._id,
          status: r.status,
          tab: borrowerTabFor(r.status, (loan?.status as LoanStatus | undefined) ?? null),
          pickupAt: r.pickupAt,
          returnBy: r.returnBy,
          message: r.message ?? null,
          declineReason: r.declineReason ?? null,
          createdAt: r.createdAt,
          updatedAt: Math.max(r.updatedAt, loan?.updatedAt ?? 0),
          tool: await toolCardOrSnapshot(ctx, r.toolId, loan),
          owner: owner ? userSummary(owner) : null,
          loan: loan
            ? { id: loan._id, status: loan.status, wasOverdue: loan.wasOverdue, feedbackGiven }
            : null,
        };
      }),
    );
  },
});

/** Borrower track record shown to owners before they approve. Verified facts only. */
async function borrowerProfile(ctx: QueryCtx, borrower: Doc<"users">) {
  const recent = await ctx.db
    .query("loans")
    .withIndex("by_borrower_status", (q) => q.eq("borrowerId", borrower._id).eq("status", "COMPLETED"))
    .order("desc")
    .take(5);
  const damage = await ctx.db
    .query("damageReports")
    .withIndex("by_subject", (q) => q.eq("subjectId", borrower._id))
    .order("desc")
    .take(10);
  return {
    ...userSummary(borrower),
    areaLabel: borrower.areaLabel ?? null,
    active: borrower.status === "ACTIVE",
    reputation: computeReputation(borrower.stats, borrower.createdAt, Date.now()),
    recentLoans: recent.map((l) => ({
      id: l._id,
      toolName: l.toolName,
      category: l.toolCategory,
      completedAt: l.completedAt ?? l.updatedAt,
      late: l.lateReturn === true,
      outcome: l.disputeOutcome ?? "RETURNED",
    })),
    damageReports: damage.map((d) => ({
      id: d._id,
      status: d.status,
      createdAt: d.createdAt,
      /** Only reports confirmed by the borrower or an admin count as verified. */
      verified: d.status === "ACKNOWLEDGED" || d.status === "UPHELD",
    })),
  };
}

/** Owner view of requests for their tools, with borrower reputation. */
export const incoming = query({
  args: { status: v.optional(vRequestStatus) },
  handler: async (ctx, { status }) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const requests = await ctx.db
      .query("borrowRequests")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", viewer._id).eq("status", status ?? "PENDING"))
      .order("desc")
      .take(100);
    const loadUser = userLoader(ctx);
    return Promise.all(
      requests.map(async (r) => {
        const borrower = await loadUser(r.borrowerId);
        const loan = r.loanId ? await ctx.db.get(r.loanId) : null;
        const tool = await toolCardOrSnapshot(ctx, r.toolId, loan);
        const open = await openLoansForTool(ctx, r.toolId);
        const conflict = r.status === "PENDING" ? findConflict(r, open) !== null : false;
        return {
          id: r._id,
          status: r.status,
          pickupAt: r.pickupAt,
          returnBy: r.returnBy,
          message: r.message ?? null,
          declineReason: r.declineReason ?? null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          hasConflict: conflict,
          tool,
          loan: loan ? { id: loan._id, status: loan.status } : null,
          borrower: borrower ? await borrowerProfile(ctx, borrower) : null,
        };
      }),
    );
  },
});

/** Count of pending incoming requests (navigation badge). */
export const incomingCount = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return 0;
    const pending = await ctx.db
      .query("borrowRequests")
      .withIndex("by_owner_status", (q) => q.eq("ownerId", viewer._id).eq("status", "PENDING"))
      .take(100);
    return pending.length;
  },
});

