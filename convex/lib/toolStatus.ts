import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { CATEGORY_LABELS, type LoanStatus } from "./constants";
import { BLOCKING_LOAN_STATUSES, deriveToolStatus, isDiscoverableStatus } from "./stateMachine";

type Ctx = QueryCtx | MutationCtx;

export async function openLoansForTool(ctx: Ctx, toolId: Id<"tools">): Promise<Doc<"loans">[]> {
  const results = await Promise.all(
    BLOCKING_LOAN_STATUSES.map((status) =>
      ctx.db
        .query("loans")
        .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", status))
        .collect(),
    ),
  );
  return results.flat();
}

export async function pendingRequestsForTool(ctx: Ctx, toolId: Id<"tools">): Promise<Doc<"borrowRequests">[]> {
  return ctx.db
    .query("borrowRequests")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "PENDING"))
    .collect();
}

/**
 * Recompute a tool's status and discoverability from its loans, requests,
 * listing toggle and owner state. Every mutation that affects any of these
 * calls this, so status is never taken from the client.
 */
export async function recomputeToolStatus(ctx: MutationCtx, toolId: Id<"tools">): Promise<Doc<"tools"> | null> {
  const tool = await ctx.db.get(toolId);
  if (!tool) return null;
  const owner = await ctx.db.get(tool.ownerId);
  const loans = await openLoansForTool(ctx, toolId);
  const pending = await ctx.db
    .query("borrowRequests")
    .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "PENDING"))
    .first();
  const status = deriveToolStatus({
    removed: tool.removedAt !== undefined,
    listed: tool.isListed,
    ownerActive: owner?.status === "ACTIVE",
    openLoanStatuses: loans.map((l) => l.status as LoanStatus),
    hasPendingRequests: pending !== null,
  });
  const discoverable = isDiscoverableStatus(status);
  if (status !== tool.status || discoverable !== tool.discoverable) {
    await ctx.db.patch(toolId, { status, discoverable, updatedAt: Date.now() });
    return { ...tool, status, discoverable };
  }
  return tool;
}

export function buildSearchText(tool: Pick<Doc<"tools">, "name" | "category" | "pickupArea" | "description">): string {
  return [tool.name, CATEGORY_LABELS[tool.category], tool.pickupArea, tool.description.slice(0, 200)].join(" ");
}
