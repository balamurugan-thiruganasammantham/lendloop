/**
 * OTP actions: secure generation, hashing, delivery and verification entry
 * points. Runs in the Convex action runtime where Web Crypto randomness is
 * available.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { OTP_CONFIG, type OtpPurpose } from "./lib/constants";
import { generateNumericOtp, hashOtp, normalizeOtpInput } from "./lib/crypto";
import { appError } from "./lib/errors";
import { collectionOtpExpiry } from "./lib/rules";
import { vOtpPurpose } from "./validators";
import type { ConsumeResult } from "./otp";

function pepper(): string {
  const value = process.env.OTP_PEPPER;
  if (!value || value.length < 32) {
    throw appError("CONFIG", "Hand-over codes are not configured on this deployment (OTP_PEPPER).");
  }
  return value;
}

function expiryFor(purpose: OtpPurpose, now: number, pickupAt: number, onDemand: boolean): number {
  if (purpose === "RETURN") return now + OTP_CONFIG.returnTtlMs;
  return onDemand ? now + OTP_CONFIG.onDemandTtlMs : collectionOtpExpiry(now, pickupAt);
}

async function issue(
  ctx: ActionCtx,
  loanId: Id<"loans">,
  purpose: OtpPurpose,
  requestedBy: string | null,
): Promise<{ code: string; expiresAt: number } | null> {
  const loan = await ctx.runQuery(internal.otp.loanForOtp, { loanId });
  if (!loan) return null;
  const now = Date.now();
  const code = generateNumericOtp(OTP_CONFIG.digits);
  const codeHash = await hashOtp(pepper(), loanId, purpose, code);
  const expiresAt = expiryFor(purpose, now, loan.pickupAt, requestedBy !== null);
  const stored = await ctx.runMutation(internal.otp.storeCode, { loanId, purpose, codeHash, expiresAt, requestedBy });
  if (!stored.ok) return null;

  if (stored.recipient && !stored.recipient.isSeed) {
    const label = purpose === "COLLECTION" ? "pickup" : "return";
    const expires = new Date(expiresAt).toUTCString();
    try {
      await ctx.runAction(internal.email.send, {
        userId: stored.recipient.userId,
        to: stored.recipient.email,
        subject: `Your LendLoop ${label} code`,
        text: [
          `Hi ${stored.recipient.name},`,
          "",
          `Your ${label} code for ${stored.toolName} is: ${code}`,
          "",
          `Read this code to ${stored.ownerName} in person at the hand-over. Never share it by message.`,
          `It expires ${expires} and can only be used once.`,
          "",
          "— LendLoop",
        ].join("\n"),
        kind: `otp_${label}`,
        sensitive: true,
      });
    } catch (error) {
      // The borrower can always reveal a fresh code in the app; never log the code itself.
      console.error("OTP email delivery failed", { loanId, purpose, error: error instanceof Error ? error.message : "unknown" });
    }
  }
  return { code, expiresAt };
}

/** Scheduled after approval (collection) or return confirmation (return). */
export const issueSystemCode = internalAction({
  args: { loanId: v.id("loans"), purpose: vOtpPurpose },
  handler: async (ctx, { loanId, purpose }) => {
    await issue(ctx, loanId, purpose, null);
    return null;
  },
});

/**
 * Borrower requests a fresh code at the meetup. The plaintext is returned
 * once, only to the authenticated borrower, and invalidates earlier codes.
 */
export const requestCode = action({
  args: { loanId: v.id("loans"), purpose: vOtpPurpose },
  handler: async (ctx, { loanId, purpose }): Promise<{ code: string; expiresAt: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError("UNAUTHENTICATED", "Please sign in to continue.");
    const result = await issue(ctx, loanId, purpose, identity.tokenIdentifier);
    if (!result) throw appError("INVALID_STATE", "A code is not needed at this stage of the loan.");
    return result;
  },
});

const FAILURE_MESSAGES: Record<Exclude<ConsumeResult, { ok: true }>["code"], string> = {
  OTP_INVALID: "That code is incorrect.",
  OTP_EXPIRED: "That code has expired. Ask the borrower to generate a new one.",
  OTP_LOCKED: "Too many incorrect attempts. Ask the borrower to generate a new code.",
  OTP_MISSING: "No active code yet. Ask the borrower to open the loan and generate one.",
};

/** Owner submits the code the borrower reads out. */
export const verifyCode = action({
  args: { loanId: v.id("loans"), purpose: vOtpPurpose, code: v.string() },
  handler: async (ctx, { loanId, purpose, code }): Promise<{ status: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError("UNAUTHENTICATED", "Please sign in to continue.");
    const normalized = normalizeOtpInput(code);
    if (!new RegExp(`^\\d{${OTP_CONFIG.digits}}$`).test(normalized)) {
      throw appError("INVALID_INPUT", `Enter the ${OTP_CONFIG.digits}-digit code.`);
    }
    const codeHash = await hashOtp(pepper(), loanId, purpose, normalized);
    const result: ConsumeResult = await ctx.runMutation(internal.otp.consumeCode, {
      loanId,
      purpose,
      codeHash,
      tokenIdentifier: identity.tokenIdentifier,
    });
    if (!result.ok) {
      throw appError(result.code, FAILURE_MESSAGES[result.code], { attemptsRemaining: result.attemptsRemaining });
    }
    return { status: result.status };
  },
});
