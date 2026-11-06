"use node";
/**
 * SMTP delivery via Nodemailer (Node.js runtime). Configure with:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, SMTP_SECURE
 */
import { v } from "convex/values";
import nodemailer from "nodemailer";
import { internalAction } from "./_generated/server";

export const sendSmtp = internalAction({
  args: { to: v.string(), subject: v.string(), text: v.string() },
  handler: async (_ctx, { to, subject, text }) => {
    const host = process.env.SMTP_HOST;
    const from = process.env.EMAIL_FROM;
    if (!host || !from) throw new Error("SMTP is not configured (SMTP_HOST / EMAIL_FROM)");
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    const info = await transport.sendMail({ from, to, subject, text });
    return { messageId: info.messageId };
  },
});
