import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { UserStats } from "./rules";

/**
 * Apply counter deltas to a user's denormalised reputation stats. Runs inside
 * the same transaction as the event that caused it, so counters cannot drift
 * from the underlying records.
 */
export async function bumpStats(ctx: MutationCtx, userId: Id<"users">, delta: Partial<UserStats>): Promise<void> {
  const user = await ctx.db.get(userId);
  if (!user) return;
  const next = { ...user.stats };
  for (const [key, value] of Object.entries(delta) as [keyof UserStats, number][]) {
    next[key] = Math.max(0, next[key] + value);
  }
  await ctx.db.patch(userId, { stats: next, updatedAt: Date.now() });
}
