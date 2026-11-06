import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { writeAudit, type ActorType } from "./audit";
import type { LoanStatus, OtpPurpose } from "./constants";
import { appError } from "./errors";
import { assertLoanTransition, TransitionError, type LifecycleActor } from "./stateMachine";

export interface TransitionActor {
  role: LifecycleActor;
  userId?: Id<"users">;
}

function auditActorType(role: LifecycleActor): ActorType {
  if (role === "ADMIN") return "ADMIN";
  if (role === "SYSTEM") return "SYSTEM";
  return "USER";
}

/**
 * Apply a validated loan status transition and record it in the audit log.
 * Throws INVALID_STATE (a user-safe error) for disallowed transitions.
 */
export async function transitionLoan(
  ctx: MutationCtx,
  loan: Doc<"loans">,
  to: LoanStatus,
  actor: TransitionActor,
  patch: Partial<Omit<Doc<"loans">, "_id" | "_creationTime" | "status">> = {},
  meta?: Record<string, string | number | boolean | null>,
): Promise<Doc<"loans">> {
  try {
    assertLoanTransition(loan.status, to, actor.role);
  } catch (e) {
    if (e instanceof TransitionError) {
      throw appError("INVALID_STATE", "This action is not available at the current stage of the loan.", {
        status: loan.status,
      });
    }
    throw e;
  }
  const now = Date.now();
  await ctx.db.patch(loan._id, { ...patch, status: to, updatedAt: now });
  await writeAudit(ctx, {
    actorId: actor.userId,
    actorType: auditActorType(actor.role),
    action: "loan.status_changed",
    resourceType: "loan",
    resourceId: loan._id,
    fromStatus: loan.status,
    toStatus: to,
    meta,
  });
  return { ...loan, ...patch, status: to, updatedAt: now };
}

/** Invalidate any outstanding codes for a loan (e.g. when the flow moves on). */
export async function supersedeOtps(ctx: MutationCtx, loanId: Id<"loans">, purpose?: OtpPurpose): Promise<void> {
  const active = await ctx.db
    .query("otpVerifications")
    .withIndex("by_loan", (q) => q.eq("loanId", loanId))
    .filter((q) => q.eq(q.field("status"), "ACTIVE"))
    .collect();
  for (const otp of active) {
    if (purpose && otp.purpose !== purpose) continue;
    await ctx.db.patch(otp._id, { status: "SUPERSEDED" });
  }
}

export function firstName(user: Pick<Doc<"users">, "name"> | null): string {
  return user?.name.trim().split(/\s+/)[0] || "Your neighbour";
}
