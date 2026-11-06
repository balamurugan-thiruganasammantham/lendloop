/**
 * Administration. Every function re-checks the ADMIN role on the server
 * (requireAdmin) and writes an audit event for every change. Hiding admin UI
 * is never relied upon for security.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireAdmin } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { appError, invalid, notFound } from "./lib/errors";
import { transitionLoan } from "./lib/loans";
import { notify } from "./lib/notify";
import { displayName, toolCard, userLoader, userSummary } from "./lib/projections";
import { computeReputation } from "./lib/rules";
import { bumpStats } from "./lib/stats";
import { recomputeToolStatus } from "./lib/toolStatus";
import { vAccountStatus, vDisputeOutcome, vLoanStatus, vUserRole } from "./validators";

function requireNote(note: string | undefined, min = 5): string {
  const text = note?.trim() ?? "";
  if (text.length < min || text.length > LIMITS.reasonMax) throw invalid(`Add a note of ${min}–${LIMITS.reasonMax} characters for the audit trail.`);
  return text;
}

async function adminNotify(ctx: MutationCtx, userId: Id<"users">, title: string, body: string, path = "/notifications") {
  await notify(ctx, { userId, type: "ADMIN_ACTION", title, body, path });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export const overview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const count = async (p: Promise<unknown[]>) => (await p).length;
    return {
      users: await count(ctx.db.query("users").take(1000)),
      suspended: await count(ctx.db.query("users").withIndex("by_status", (q) => q.eq("status", "SUSPENDED")).take(1000)),
      discoverableTools: await count(ctx.db.query("tools").withIndex("by_discoverable_created", (q) => q.eq("discoverable", true)).take(1000)),
      disputes: await count(ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "DISPUTED")).take(1000)),
      damageReported: await count(ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "DAMAGE_REPORTED")).take(1000)),
      openDamageReports:
        (await count(ctx.db.query("damageReports").withIndex("by_status", (q) => q.eq("status", "OPEN")).take(1000))) +
        (await count(ctx.db.query("damageReports").withIndex("by_status", (q) => q.eq("status", "CONTESTED")).take(1000))),
      openReports: await count(ctx.db.query("userReports").withIndex("by_status", (q) => q.eq("status", "OPEN")).take(1000)),
      automationFailures: await count(ctx.db.query("automationFailures").withIndex("by_status", (q) => q.eq("status", "OPEN")).take(1000)),
      deadEvents: await count(ctx.db.query("automationEvents").withIndex("by_status", (q) => q.eq("status", "DEAD")).take(1000)),
    };
  },
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = query({
  args: { search: v.optional(v.string()) },
  handler: async (ctx, { search }) => {
    await requireAdmin(ctx);
    const all = await ctx.db.query("users").order("desc").take(500);
    const term = search?.trim().toLowerCase() ?? "";
    const filtered = term ? all.filter((u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)) : all;
    return filtered.slice(0, 200).map((u) => ({
      id: u._id,
      name: u.name,
      email: u.email,
      imageUrl: u.imageUrl ?? null,
      role: u.role,
      status: u.status,
      suspendedReason: u.suspendedReason ?? null,
      trustedLender: u.trustedLender,
      createdAt: u.createdAt,
      isSeed: u.isSeed === true,
      reputation: computeReputation(u.stats, u.createdAt, Date.now()),
      itemsListed: u.stats.itemsListed,
    }));
  },
});

export const setTrusted = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    const admin = await requireAdmin(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw notFound("User");
    if (user.trustedLender === trusted) return null;
    await ctx.db.patch(userId, { trustedLender: trusted, updatedAt: Date.now() });
    await writeAudit(ctx, {
      actorId: admin._id,
      actorType: "ADMIN",
      action: trusted ? "admin.trusted_granted" : "admin.trusted_revoked",
      resourceType: "user",
      resourceId: userId,
    });
    await adminNotify(
      ctx,
      userId,
      trusted ? "You're a Trusted Lender" : "Trusted Lender status removed",
      trusted
        ? "An administrator marked you as a Trusted Lender. The badge now appears on your listings."
        : "Your Trusted Lender badge was removed by an administrator.",
      "/profile",
    );
    return null;
  },
});

export const setStatus = mutation({
  args: { userId: v.id("users"), status: vAccountStatus, reason: v.optional(v.string()) },
  handler: async (ctx, { userId, status, reason }) => {
    const admin = await requireAdmin(ctx);
    if (userId === admin._id) throw appError("FORBIDDEN", "You cannot change your own account status.");
    const user = await ctx.db.get(userId);
    if (!user) throw notFound("User");
    if (user.status === status) return null;
    const note = status === "SUSPENDED" ? requireNote(reason) : reason?.trim() || undefined;
    await ctx.db.patch(userId, { status, suspendedReason: status === "SUSPENDED" ? note : undefined, updatedAt: Date.now() });

    if (status === "SUSPENDED") {
      // Withdraw their open borrow requests; their listings disappear from discovery.
      const pending = await ctx.db
        .query("borrowRequests")
        .withIndex("by_borrower_status", (q) => q.eq("borrowerId", userId).eq("status", "PENDING"))
        .collect();
      const now = Date.now();
      for (const r of pending) {
        await ctx.db.patch(r._id, { status: "CANCELLED", decidedAt: now, updatedAt: now });
        await writeAudit(ctx, {
          actorId: admin._id,
          actorType: "ADMIN",
          action: "request.cancelled",
          resourceType: "request",
          resourceId: r._id,
          fromStatus: "PENDING",
          toStatus: "CANCELLED",
          meta: { reason: "account_suspended" },
        });
        await recomputeToolStatus(ctx, r.toolId);
      }
    }
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const t of tools) await recomputeToolStatus(ctx, t._id);

    await writeAudit(ctx, {
      actorId: admin._id,
      actorType: "ADMIN",
      action: status === "SUSPENDED" ? "admin.user_suspended" : "admin.user_reinstated",
      resourceType: "user",
      resourceId: userId,
      fromStatus: user.status,
      toStatus: status,
      meta: { note: note ?? null },
    });
    await adminNotify(
      ctx,
      userId,
      status === "SUSPENDED" ? "Account suspended" : "Account reinstated",
      status === "SUSPENDED"
        ? `Your account was suspended by an administrator: ${note}`
        : "Your account has been reinstated. Your listings are visible again.",
      "/profile",
    );
    return null;
  },
});

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export const tools = query({
  args: { includeRemoved: v.optional(v.boolean()) },
  handler: async (ctx, { includeRemoved }) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("tools").order("desc").take(300);
    const loadUser = userLoader(ctx);
    const visible = includeRemoved ? rows : rows.filter((t) => t.removedAt === undefined);
    return Promise.all(
      visible.map(async (t) => {
        const owner = await loadUser(t.ownerId);
        return {
          ...(await toolCard(ctx, t)),
          isListed: t.isListed,
          removed: t.removedAt !== undefined,
          removedReason: t.removedReason ?? null,
          owner: owner ? { id: owner._id, name: displayName(owner.name), email: owner.email } : null,
        };
      }),
    );
  },
});

export const removeTool = mutation({
  args: { toolId: v.id("tools"), reason: v.string() },
  handler: async (ctx, { toolId, reason }) => {
    const admin = await requireAdmin(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw notFound("Listing");
    if (tool.removedAt !== undefined) return null;
    const note = requireNote(reason);
    const now = Date.now();
    await ctx.db.patch(toolId, { removedAt: now, removedBy: admin._id, removedReason: note, updatedAt: now });
    const pending = await ctx.db
      .query("borrowRequests")
      .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "PENDING"))
      .collect();
    for (const r of pending) {
      await ctx.db.patch(r._id, { status: "DECLINED", declineReason: "This listing was removed.", decidedAt: now, updatedAt: now });
      await notify(ctx, {
        userId: r.borrowerId,
        type: "REQUEST_DECLINED",
        title: "Request closed",
        body: `${tool.name} is no longer available.`,
        path: "/requests?tab=DECLINED",
        requestId: r._id,
        toolId,
        toolName: tool.name,
        status: "DECLINED",
      });
    }
    await bumpStats(ctx, tool.ownerId, { itemsListed: -1 });
    await recomputeToolStatus(ctx, toolId);
    await writeAudit(ctx, {
      actorId: admin._id,
      actorType: "ADMIN",
      action: "admin.tool_removed",
      resourceType: "tool",
      resourceId: toolId,
      fromStatus: tool.status,
      toStatus: "REMOVED",
      meta: { note },
    });
    await adminNotify(ctx, tool.ownerId, "Listing removed", `An administrator removed “${tool.name}”: ${note}`, "/listings");
    return null;
  },
});

export const restoreTool = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const admin = await requireAdmin(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw notFound("Listing");
    if (tool.removedAt === undefined) return null;
    await ctx.db.patch(toolId, { removedAt: undefined, removedBy: undefined, removedReason: undefined, updatedAt: Date.now() });
    await bumpStats(ctx, tool.ownerId, { itemsListed: 1 });
    const updated = await recomputeToolStatus(ctx, toolId);
    await writeAudit(ctx, {
      actorId: admin._id,
      actorType: "ADMIN",
      action: "admin.tool_restored",
      resourceType: "tool",
      resourceId: toolId,
      fromStatus: "REMOVED",
      toStatus: updated?.status,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Loans & disputes
// ---------------------------------------------------------------------------

async function loanAdminRow(ctx: Parameters<typeof userLoader>[0], loan: Doc<"loans">, loadUser: ReturnType<typeof userLoader>) {
  const [owner, borrower] = await Promise.all([loadUser(loan.ownerId), loadUser(loan.borrowerId)]);
  return {
    id: loan._id,
    status: loan.status,
    toolName: loan.toolName,
    pickupAt: loan.pickupAt,
    returnBy: loan.returnBy,
    updatedAt: loan.updatedAt,
    wasOverdue: loan.wasOverdue,
    disputeReason: loan.disputeReason ?? null,
    disputeOutcome: loan.disputeOutcome ?? null,
    owner: owner ? userSummary(owner) : null,
    borrower: borrower ? userSummary(borrower) : null,
  };
}

export const loans = query({
  args: { status: v.optional(vLoanStatus) },
  handler: async (ctx, { status }) => {
    await requireAdmin(ctx);
    const rows = status
      ? await ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", status)).order("desc").take(200)
      : await ctx.db.query("loans").order("desc").take(200);
    const loadUser = userLoader(ctx);
    return Promise.all(rows.map((l) => loanAdminRow(ctx, l, loadUser)));
  },
});

export const disputes = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const disputed = await ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "DISPUTED")).take(200);
    const damaged = await ctx.db.query("loans").withIndex("by_status", (q) => q.eq("status", "DAMAGE_REPORTED")).take(200);
    const loadUser = userLoader(ctx);
    return Promise.all(
      [...disputed, ...damaged].map(async (l) => ({
        ...(await loanAdminRow(ctx, l, loadUser)),
        damageReports: (
          await ctx.db.query("damageReports").withIndex("by_loan", (q) => q.eq("loanId", l._id)).collect()
        ).map((d) => ({ id: d._id, status: d.status, description: d.description, borrowerResponse: d.borrowerResponse ?? null })),
      })),
    );
  },
});

/**
 * Close a disputed loan.
 *  RETURNED      – the tool is back: complete normally.
 *  NOT_RETURNED  – confirmed missing: complete with a verified incident; the
 *                  listing stays unlisted until the owner relists it.
 *  REOPEN        – return the loan to ACTIVE so the parties can finish it.
 */
export const resolveDispute = mutation({
  args: { loanId: v.id("loans"), outcome: vDisputeOutcome, note: v.string() },
  handler: async (ctx, { loanId, outcome, note }) => {
    const admin = await requireAdmin(ctx);
    const loan = await ctx.db.get(loanId);
    if (!loan) throw notFound("Loan");
    if (loan.status !== "DISPUTED") throw appError("INVALID_STATE", "Only disputed loans can be resolved here.");
    const text = requireNote(note);
    const now = Date.now();
    const actor = { role: "ADMIN" as const, userId: admin._id };
    if (outcome === "REOPEN") {
      await transitionLoan(ctx, loan, "ACTIVE_LOAN", actor, { disputeOutcome: "REOPEN", disputeResolutionNote: text }, { outcome });
    } else {
      await transitionLoan(
        ctx,
        loan,
        "COMPLETED",
        actor,
        {
          disputeOutcome: outcome,
          disputeResolutionNote: text,
          completedAt: now,
          returnedAt: outcome === "RETURNED" ? now : undefined,
        },
        { outcome },
      );
      if (outcome === "RETURNED") {
        await bumpStats(ctx, loan.borrowerId, { borrowingCompleted: 1, lateReturns: loan.lateReturn || loan.wasOverdue ? 1 : 0 });
        await bumpStats(ctx, loan.ownerId, { lendingCompleted: 1 });
      } else {
        await bumpStats(ctx, loan.borrowerId, { notReturnedVerified: 1 });
        await ctx.db.patch(loan.toolId, { isListed: false, updatedAt: now });
      }
    }
    await recomputeToolStatus(ctx, loan.toolId);
    for (const userId of [loan.ownerId, loan.borrowerId]) {
      await adminNotify(
        ctx,
        userId,
        "Dispute resolved",
        `An administrator resolved the dispute for ${loan.toolName} (${outcome.replace("_", " ").toLowerCase()}): ${text}`,
        `/loans/${loanId}`,
      );
    }
    return null;
  },
});

export const damageReports = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("damageReports").order("desc").take(200);
    const loadUser = userLoader(ctx);
    return Promise.all(
      rows.map(async (d) => {
        const [reporter, subject] = await Promise.all([loadUser(d.reporterId), loadUser(d.subjectId)]);
        const evidence = await Promise.all(d.evidenceIds.map((id) => ctx.storage.getUrl(id)));
        const loan = await ctx.db.get(d.loanId);
        return {
          id: d._id,
          loanId: d.loanId,
          toolName: loan?.toolName ?? "—",
          status: d.status,
          description: d.description,
          borrowerResponse: d.borrowerResponse ?? null,
          resolutionNote: d.resolutionNote ?? null,
          evidence: evidence.filter((u): u is string => !!u),
          createdAt: d.createdAt,
          reporter: reporter ? userSummary(reporter) : null,
          subject: subject ? userSummary(subject) : null,
        };
      }),
    );
  },
});

export const reviewDamage = mutation({
  args: { reportId: v.id("damageReports"), decision: v.union(v.literal("UPHOLD"), v.literal("DISMISS")), note: v.string() },
  handler: async (ctx, { reportId, decision, note }) => {
    const admin = await requireAdmin(ctx);
    const report = await ctx.db.get(reportId);
    if (!report) throw notFound("Damage report");
    if (report.status !== "OPEN" && report.status !== "CONTESTED") {
      throw appError("INVALID_STATE", "This report has already been resolved.");
    }
    const text = requireNote(note);
    const next = decision === "UPHOLD" ? "UPHELD" : "DISMISSED";
    await ctx.db.patch(reportId, { status: next, resolutionNote: text, resolvedBy: admin._id, updatedAt: Date.now() });
    if (decision === "UPHOLD") await bumpStats(ctx, report.subjectId, { damageReportsVerified: 1 });
    await writeAudit(ctx, {
      actorId: admin._id,
      actorType: "ADMIN",
      action: "admin.damage_reviewed",
      resourceType: "damageReport",
      resourceId: reportId,
      fromStatus: report.status,
      toStatus: next,
      meta: { note: text },
    });
    for (const userId of [report.reporterId, report.subjectId]) {
      await adminNotify(
        ctx,
        userId,
        decision === "UPHOLD" ? "Damage report upheld" : "Damage report dismissed",
        `An administrator reviewed the damage report: ${text}`,
        `/loans/${report.loanId}`,
      );
    }
    return null;
  },
});

// ---------------------------------------------------------------------------
// Reported feedback
// ---------------------------------------------------------------------------

export const reports = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const rows = await ctx.db.query("userReports").withIndex("by_status", (q) => q.eq("status", "OPEN")).take(200);
    const loadUser = userLoader(ctx);
    return Promise.all(
      rows.map(async (r) => {
        const reporter = await loadUser(r.reporterId);
        const fbId = r.targetType === "FEEDBACK" ? ctx.db.normalizeId("feedback", r.targetId) : null;
        const fb = fbId ? await ctx.db.get(fbId) : null;
        const author = fb ? await loadUser(fb.authorId) : null;
        return {
          id: r._id,
          targetType: r.targetType,
          reason: r.reason,
          createdAt: r.createdAt,
          reporter: reporter ? userSummary(reporter) : null,
          feedback: fb
            ? { id: fb._id, rating: fb.rating, comment: fb.comment ?? null, tags: fb.tags, status: fb.status, author: author ? userSummary(author) : null }
            : null,
        };
      }),
    );
  },
});

export const reviewReport = mutation({
  args: { reportId: v.id("userReports"), action: v.union(v.literal("DISMISS"), v.literal("HIDE_FEEDBACK")), note: v.string() },
  handler: async (ctx, { reportId, action, note }) => {
    const admin = await requireAdmin(ctx);
    const report = await ctx.db.get(reportId);
    if (!report) throw notFound("Report");
    if (report.status !== "OPEN") throw appError("INVALID_STATE", "This report has already been reviewed.");
    const text = requireNote(note);
    const fbId = report.targetType === "FEEDBACK" ? ctx.db.normalizeId("feedback", report.targetId) : null;
    const fb = fbId ? await ctx.db.get(fbId) : null;
    if (action === "HIDE_FEEDBACK") {
      if (!fb) throw notFound("Feedback");
      if (fb.status !== "HIDDEN") {
        await ctx.db.patch(fb._id, { status: "HIDDEN" });
        // Hidden feedback no longer counts toward the subject's rating.
        await bumpStats(ctx, fb.subjectId, { ratingSum: -fb.rating, ratingCount: -1 });
      }
    } else if (fb && fb.status === "REPORTED") {
      await ctx.db.patch(fb._id, { status: "VISIBLE" });
    }
    await ctx.db.patch(reportId, {
      status: action === "DISMISS" ? "DISMISSED" : "ACTIONED",
      reviewedBy: admin._id,
      reviewNote: text,
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: admin._id,
      actorType: "ADMIN",
      action: action === "DISMISS" ? "admin.report_dismissed" : "admin.feedback_hidden",
      resourceType: "userReport",
      resourceId: reportId,
      meta: { feedbackId: fb?._id ?? null, note: text },
    });
    await adminNotify(ctx, report.reporterId, "Report reviewed", `An administrator reviewed your report: ${text}`);
    return null;
  },
});

// ---------------------------------------------------------------------------
// Automation & audit
// ---------------------------------------------------------------------------

export const automation = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const failures = await ctx.db.query("automationFailures").order("desc").take(100);
    const problemEvents = [
      ...(await ctx.db.query("automationEvents").withIndex("by_status", (q) => q.eq("status", "DEAD")).take(100)),
      ...(await ctx.db.query("automationEvents").withIndex("by_status", (q) => q.eq("status", "FAILED")).take(100)),
      ...(await ctx.db.query("automationEvents").withIndex("by_status", (q) => q.eq("status", "SKIPPED")).take(50)),
    ];
    const recentEvents = await ctx.db.query("automationEvents").order("desc").take(30);
    const runs = await ctx.db.query("automationRuns").order("desc").take(20);
    const reminders = await ctx.db.query("automationReminders").order("desc").take(30);
    const project = (e: Doc<"automationEvents">) => ({
      id: e._id,
      eventId: e.eventId,
      eventType: e.eventType,
      status: e.status,
      attempts: e.attempts,
      lastError: e.lastError ?? null,
      nextAttemptAt: e.nextAttemptAt ?? null,
      deliveryResult: e.deliveryResult ?? null,
      deliveryError: e.deliveryError ?? null,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    });
    return {
      configured: Boolean(process.env.N8N_WEBHOOK_URL && process.env.N8N_WEBHOOK_SECRET),
      inboundConfigured: Boolean(process.env.AUTOMATION_INBOUND_SECRET),
      emailMode: process.env.EMAIL_DELIVERY_MODE === "smtp" ? "smtp" : "mock",
      failures: failures.map((f) => ({
        id: f._id,
        workflowName: f.workflowName,
        executionId: f.executionId ?? null,
        failedNode: f.failedNode ?? null,
        errorMessage: f.errorMessage,
        relatedEventId: f.relatedEventId ?? null,
        occurredAt: f.occurredAt,
        status: f.status,
      })),
      problemEvents: problemEvents.map(project),
      recentEvents: recentEvents.map(project),
      runs: runs.map((r) => ({
        id: r._id,
        workflowName: r.workflowName,
        executionId: r.executionId ?? null,
        processed: r.processed,
        sent: r.sent,
        skipped: r.skipped,
        failed: r.failed,
        finishedAt: r.finishedAt,
      })),
      reminders: reminders.map((r) => ({
        id: r._id,
        reminderKey: r.reminderKey,
        status: r.status,
        attempts: r.attempts,
        error: r.error ?? null,
        claimedAt: r.claimedAt,
        completedAt: r.completedAt ?? null,
      })),
    };
  },
});

export const retryEvent = mutation({
  args: { automationEventId: v.id("automationEvents") },
  handler: async (ctx, { automationEventId }) => {
    const admin = await requireAdmin(ctx);
    const ev = await ctx.db.get(automationEventId);
    if (!ev) throw notFound("Event");
    if (ev.status === "DELIVERED" && ev.deliveryResult !== "FAILED") {
      throw appError("INVALID_STATE", "This event was already delivered.");
    }
    await ctx.db.patch(ev._id, {
      status: "PENDING",
      attempts: 0,
      nextAttemptAt: undefined,
      claimedAt: undefined,
      deliveryResult: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.automation.deliverEvent, { automationEventId });
    await writeAudit(ctx, {
      actorId: admin._id,
      actorType: "ADMIN",
      action: "admin.automation_retry",
      resourceType: "automation",
      resourceId: ev.eventId,
      fromStatus: ev.status,
      toStatus: "PENDING",
    });
    return null;
  },
});

export const resolveFailure = mutation({
  args: { failureId: v.id("automationFailures") },
  handler: async (ctx, { failureId }) => {
    const admin = await requireAdmin(ctx);
    const f = await ctx.db.get(failureId);
    if (!f) throw notFound("Failure");
    if (f.status === "RESOLVED") return null;
    await ctx.db.patch(failureId, { status: "RESOLVED", resolvedBy: admin._id, resolvedAt: Date.now() });
    await writeAudit(ctx, {
      actorId: admin._id,
      actorType: "ADMIN",
      action: "admin.automation_failure_resolved",
      resourceType: "automation",
      resourceId: failureId,
    });
    return null;
  },
});

export const auditLogs = query({
  args: { resourceType: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { resourceType, limit }) => {
    await requireAdmin(ctx);
    const take = Math.min(Math.max(limit ?? 100, 1), 300);
    const rows = await ctx.db.query("auditLogs").order("desc").take(resourceType ? 1000 : take);
    const filtered = (resourceType ? rows.filter((r) => r.resourceType === resourceType) : rows).slice(0, take);
    const loadUser = userLoader(ctx);
    return Promise.all(
      filtered.map(async (r) => {
        const actor = r.actorId ? await loadUser(r.actorId) : null;
        return {
          id: r._id,
          action: r.action,
          actorType: r.actorType,
          actor: actor ? displayName(actor.name) : null,
          resourceType: r.resourceType,
          resourceId: r.resourceId,
          fromStatus: r.fromStatus ?? null,
          toStatus: r.toStatus ?? null,
          meta: r.meta ?? null,
          createdAt: r.createdAt,
        };
      }),
    );
  },
});

/**
 * Secure, server-side role assignment. Not callable from clients; run with:
 *   npx convex run admin:setRoleByEmail '{"email":"you@example.com","role":"ADMIN"}'
 */
export const setRoleByEmail = internalMutation({
  args: { email: v.string(), role: vUserRole },
  handler: async (ctx, { email, role }) => {
    const matches = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email.trim()))
      .collect();
    if (matches.length === 0) throw new Error(`No user with email ${email}. Sign in once first.`);
    if (matches.length > 1) throw new Error("Multiple users share that email; resolve manually.");
    const user = matches[0]!;
    await ctx.db.patch(user._id, { role, updatedAt: Date.now() });
    await writeAudit(ctx, {
      actorType: "SYSTEM",
      action: "admin.role_changed",
      resourceType: "user",
      resourceId: user._id,
      fromStatus: user.role,
      toStatus: role,
      meta: { via: "cli" },
    });
    return { userId: user._id, role };
  },
});

