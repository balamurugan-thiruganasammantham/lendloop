import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { writeAudit } from "./lib/audit";
import { requireActiveViewer } from "./lib/auth";
import { LIMITS } from "./lib/constants";
import { appError, invalid, notFound } from "./lib/errors";
import { firstName } from "./lib/loans";
import { notify } from "./lib/notify";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { feedbackEligibility, validateFeedbackTags } from "./lib/rules";
import { bumpStats } from "./lib/stats";
import { vFeedbackTag } from "./validators";

/**
 * Leave feedback for the other participant of a completed loan. One entry per
 * participant per loan, enforced inside the transaction.
 */
export const submit = mutation({
  args: {
    loanId: v.id("loans"),
    rating: v.number(),
    comment: v.optional(v.string()),
    tags: v.array(vFeedbackTag),
  },
  handler: async (ctx, args) => {
    const viewer = await requireActiveViewer(ctx);
    await enforceRateLimit(ctx, `feedback:${viewer._id}`, RATE_LIMITS.feedback);
    const loan = await ctx.db.get(args.loanId);
    if (!loan) throw notFound("Loan");
    const viewerIsBorrower = loan.borrowerId === viewer._id;
    const viewerIsOwner = loan.ownerId === viewer._id;
    if (!viewerIsBorrower && !viewerIsOwner) throw notFound("Loan");

    const existing = await ctx.db
      .query("feedback")
      .withIndex("by_loan_author", (q) => q.eq("loanId", loan._id).eq("authorId", viewer._id))
      .first();
    const eligibility = feedbackEligibility({
      loanStatus: loan.status,
      viewerIsBorrower,
      viewerIsOwner,
      alreadySubmitted: existing !== null,
    });
    if (!eligibility.ok) {
      throw appError(eligibility.code === "DUPLICATE" ? "DUPLICATE" : "INVALID_STATE", eligibility.message);
    }
    if (!Number.isInteger(args.rating) || args.rating < 1 || args.rating > 5) throw invalid("Rating must be 1 to 5 stars.");
    const comment = args.comment?.trim() ?? "";
    if (comment.length > LIMITS.feedbackCommentMax) throw invalid("Feedback is too long.");
    const direction = viewerIsBorrower ? "BORROWER_TO_OWNER" : "OWNER_TO_BORROWER";
    const tagCheck = validateFeedbackTags(direction, args.tags);
    if (!tagCheck.ok) throw invalid(tagCheck.message);

    const subjectId = viewerIsBorrower ? loan.ownerId : loan.borrowerId;
    const feedbackId = await ctx.db.insert("feedback", {
      loanId: loan._id,
      authorId: viewer._id,
      subjectId,
      direction,
      rating: args.rating,
      comment: comment || undefined,
      tags: args.tags,
      status: "VISIBLE",
      createdAt: Date.now(),
    });
    await bumpStats(ctx, subjectId, { ratingSum: args.rating, ratingCount: 1 });
    await writeAudit(ctx, {
      actorId: viewer._id,
      actorType: "USER",
      action: "feedback.submitted",
      resourceType: "feedback",
      resourceId: feedbackId,
      meta: { loanId: loan._id, rating: args.rating },
    });
    await notify(ctx, {
      userId: subjectId,
      type: "FEEDBACK_RECEIVED",
      title: "New feedback",
      body: `${firstName(viewer)} left you ${args.rating}★ feedback for ${loan.toolName}.`,
      path: `/loans/${loan._id}`,
      loanId: loan._id,
      toolId: loan.toolId,
    });
    return feedbackId;
  },
});

/** The subject of a review can flag it as abusive or fraudulent for admin review. */
export const report = mutation({
  args: { feedbackId: v.id("feedback"), reason: v.string() },
  handler: async (ctx, { feedbackId, reason }) => {
    const viewer = await requireActiveViewer(ctx);
    await enforceRateLimit(ctx, `report:${viewer._id}`, RATE_LIMITS.report);
    const fb = await ctx.db.get(feedbackId);
    if (!fb || fb.subjectId !== viewer._id) throw notFound("Feedback");
    const text = reason.trim();
    if (text.length < 10 || text.length > LIMITS.reasonMax) throw invalid("Explain the problem in 10–500 characters.");
    const dup = await ctx.db
      .query("userReports")
      .withIndex("by_reporter_target", (q) =>
        q.eq("reporterId", viewer._id).eq("targetType", "FEEDBACK").eq("targetId", feedbackId),
      )
      .first();
    if (dup) throw appError("DUPLICATE", "You have already reported this feedback.");
    const now = Date.now();
    const reportId = await ctx.db.insert("userReports", {
      reporterId: viewer._id,
      targetType: "FEEDBACK",
      targetId: feedbackId,
      reason: text,
      status: "OPEN",
      createdAt: now,
      updatedAt: now,
    });
    if (fb.status === "VISIBLE") await ctx.db.patch(feedbackId, { status: "REPORTED" });
    await writeAudit(ctx, {
      actorId: viewer._id,
      actorType: "USER",
      action: "feedback.reported",
      resourceType: "userReport",
      resourceId: reportId,
      meta: { feedbackId },
    });
    return reportId;
  },
});
