import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getViewer, requireViewer } from "./lib/auth";
import { notFound } from "./lib/errors";

export const list = query({
  args: { limit: v.optional(v.number()), unreadOnly: v.optional(v.boolean()) },
  handler: async (ctx, { limit, unreadOnly }) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const take = Math.min(Math.max(limit ?? 30, 1), 100);
    const rows = unreadOnly
      ? await ctx.db
          .query("notifications")
          .withIndex("by_user_read", (q) => q.eq("userId", viewer._id).eq("read", false))
          .order("desc")
          .take(take)
      : await ctx.db
          .query("notifications")
          .withIndex("by_user", (q) => q.eq("userId", viewer._id))
          .order("desc")
          .take(take);
    return rows.map((n) => ({
      id: n._id,
      type: n.type,
      title: n.title,
      body: n.body,
      loanId: n.loanId ?? null,
      toolId: n.toolId ?? null,
      requestId: n.requestId ?? null,
      read: n.read,
      createdAt: n.createdAt,
    }));
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", viewer._id).eq("read", false))
      .take(100);
    return unread.length;
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const viewer = await requireViewer(ctx);
    const n = await ctx.db.get(notificationId);
    if (!n || n.userId !== viewer._id) throw notFound("Notification");
    if (!n.read) await ctx.db.patch(notificationId, { read: true, readAt: Date.now() });
    return null;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const viewer = await requireViewer(ctx);
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", viewer._id).eq("read", false))
      .take(500);
    const now = Date.now();
    for (const n of unread) await ctx.db.patch(n._id, { read: true, readAt: now });
    return unread.length;
  },
});
