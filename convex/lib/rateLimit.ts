import type { MutationCtx } from "../_generated/server";
import { appError } from "./errors";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS = {
  createRequest: { limit: 20, windowMs: 60 * 60 * 1000 },
  createTool: { limit: 20, windowMs: 60 * 60 * 1000 },
  uploadUrl: { limit: 60, windowMs: 60 * 60 * 1000 },
  otpIssue: { limit: 6, windowMs: 60 * 60 * 1000 },
  otpVerify: { limit: 15, windowMs: 15 * 60 * 1000 },
  feedback: { limit: 30, windowMs: 60 * 60 * 1000 },
  report: { limit: 10, windowMs: 60 * 60 * 1000 },
  profileUpdate: { limit: 30, windowMs: 60 * 60 * 1000 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window rate limiter. Throws RATE_LIMITED when the limit is exceeded.
 * Because Convex mutations are transactional, concurrent calls are serialised
 * on the counter document and cannot both slip under the limit.
 */
export async function enforceRateLimit(ctx: MutationCtx, key: string, rule: RateLimitRule): Promise<void> {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (!existing || now - existing.windowStart >= rule.windowMs) {
    if (existing) await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
    else await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    return;
  }
  if (existing.count >= rule.limit) {
    const retryAfterSec = Math.ceil((existing.windowStart + rule.windowMs - now) / 1000);
    throw appError("RATE_LIMITED", "Too many attempts. Please wait and try again.", { retryAfterSec });
  }
  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}
