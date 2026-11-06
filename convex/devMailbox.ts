/**
 * Development mailbox (EMAIL_DELIVERY_MODE=mock). Lets reviewers see emails,
 * including hand-over codes, without an SMTP provider. Each user can only see
 * their own messages, messages expire after 24h, and the query returns
 * nothing unless mock mode is active.
 */
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { getViewer } from "./lib/auth";
import { TIME } from "./lib/constants";

const isMock = () => process.env.EMAIL_DELIVERY_MODE !== "smtp";

export const record = internalMutation({
  args: { userId: v.id("users"), to: v.string(), subject: v.string(), text: v.string(), kind: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("devMailbox", { ...args, createdAt: Date.now() });
    return null;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    if (!isMock()) return { enabled: false, messages: [] };
    const viewer = await getViewer(ctx);
    if (!viewer) return { enabled: true, messages: [] };
    const cutoff = Date.now() - TIME.day;
    const messages = await ctx.db
      .query("devMailbox")
      .withIndex("by_user", (q) => q.eq("userId", viewer._id))
      .order("desc")
      .take(50);
    return {
      enabled: true,
      messages: messages
        .filter((m) => m.createdAt > cutoff)
        .map((m) => ({ id: m._id, to: m.to, subject: m.subject, text: m.text, kind: m.kind, createdAt: m.createdAt })),
    };
  },
});

export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - TIME.day;
    const old = await ctx.db
      .query("devMailbox")
      .filter((q) => q.lt(q.field("createdAt"), cutoff))
      .take(500);
    for (const m of old) await ctx.db.delete(m._id);
    return old.length;
  },
});
