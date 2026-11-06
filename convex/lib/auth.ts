import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError, forbidden } from "./errors";

type Ctx = QueryCtx | MutationCtx;

export async function getUserByToken(ctx: Ctx, tokenIdentifier: string): Promise<Doc<"users"> | null> {
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

/** Current user or null (signed out, or profile not yet synchronised). */
export async function getViewer(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return getUserByToken(ctx, identity.tokenIdentifier);
}

export async function requireViewer(ctx: Ctx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw appError("UNAUTHENTICATED", "Please sign in to continue.");
  const user = await getUserByToken(ctx, identity.tokenIdentifier);
  if (!user) throw appError("PROFILE_MISSING", "Your profile is still being set up. Please retry.");
  return user;
}

export function assertActive(user: Doc<"users">): void {
  if (user.status !== "ACTIVE") {
    throw appError("ACCOUNT_SUSPENDED", "Your account is suspended. Contact support if you think this is a mistake.");
  }
}

/** Signed in, profile exists, account active. Required for every write. */
export async function requireActiveViewer(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireViewer(ctx);
  assertActive(user);
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireActiveViewer(ctx);
  if (user.role !== "ADMIN") throw forbidden("Administrator access required.");
  return user;
}

export function isAdmin(user: Doc<"users"> | null): boolean {
  return user?.role === "ADMIN" && user.status === "ACTIVE";
}

export type LoanRole = "BORROWER" | "OWNER" | "ADMIN";

/** Resolve the viewer's relationship to a loan, or throw (prevents IDOR). */
export function loanRoleOf(user: Doc<"users">, loan: Doc<"loans">, allowAdmin = true): LoanRole {
  if (loan.borrowerId === user._id) return "BORROWER";
  if (loan.ownerId === user._id) return "OWNER";
  if (allowAdmin && isAdmin(user)) return "ADMIN";
  throw appError("NOT_FOUND", "Loan not found.");
}
