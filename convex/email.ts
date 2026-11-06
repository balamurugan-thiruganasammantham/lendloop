/**
 * Email delivery abstraction for messages that must not pass through n8n
 * (hand-over codes).
 *
 *   EMAIL_DELIVERY_MODE=mock  → written to the development mailbox (default)
 *   EMAIL_DELIVERY_MODE=smtp  → sent with Nodemailer (see emailNode.ts)
 *
 * Mock mode is refused for sensitive mail when DEPLOYMENT_ENV=production so a
 * misconfigured production deployment can never store codes in the database.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

export type EmailMode = "mock" | "smtp";

export function emailMode(): EmailMode {
  return process.env.EMAIL_DELIVERY_MODE === "smtp" ? "smtp" : "mock";
}

export const send = internalAction({
  args: {
    userId: v.id("users"),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    kind: v.string(),
    sensitive: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ mode: EmailMode }> => {
    const mode = emailMode();
    if (mode === "smtp") {
      await ctx.runAction(internal.emailNode.sendSmtp, { to: args.to, subject: args.subject, text: args.text });
      return { mode };
    }
    if (args.sensitive && process.env.DEPLOYMENT_ENV === "production") {
      throw new Error("Refusing to store sensitive email in mock mailbox on a production deployment");
    }
    await ctx.runMutation(internal.devMailbox.record, {
      userId: args.userId,
      to: args.to,
      subject: args.subject,
      text: args.text,
      kind: args.kind,
    });
    return { mode };
  },
});
