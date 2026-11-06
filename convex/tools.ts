import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { claimImages, releaseImages } from "./files";
import { writeAudit } from "./lib/audit";
import { getViewer, isAdmin, requireActiveViewer, requireViewer } from "./lib/auth";
import { LIMITS, MAX_DISCOVERY_RADIUS_KM, type ToolCategory, type ToolCondition } from "./lib/constants";
import { forbidden, invalid, notFound, appError } from "./lib/errors";
import { approximateLocation, boundingBox, haversineKm, inBox, isValidLatLng, type LatLng } from "./lib/geo";
import { notify } from "./lib/notify";
import { imageUrls, toolCard, userLoader, userSummary } from "./lib/projections";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { computeReputation } from "./lib/rules";
import { bumpStats } from "./lib/stats";
import { buildSearchText, openLoansForTool, recomputeToolStatus } from "./lib/toolStatus";
import { vToolCategory, vToolCondition } from "./validators";

const toolFields = {
  name: v.string(),
  category: vToolCategory,
  description: v.string(),
  condition: vToolCondition,
  imageIds: v.array(v.id("_storage")),
  pickupArea: v.string(),
  pickupLocation: v.object({ lat: v.number(), lng: v.number() }),
  pickupAddress: v.optional(v.string()),
  instructions: v.optional(v.string()),
  lendingTerms: v.optional(v.string()),
  depositAmount: v.optional(v.number()),
  maxLoanDays: v.number(),
  availableFrom: v.optional(v.number()),
  availableUntil: v.optional(v.number()),
};

interface ToolInput {
  name: string;
  category: ToolCategory;
  description: string;
  condition: ToolCondition;
  pickupArea: string;
  pickupLocation: LatLng;
  pickupAddress?: string;
  instructions?: string;
  lendingTerms?: string;
  depositAmount?: number;
  maxLoanDays: number;
  availableFrom?: number;
  availableUntil?: number;
}

function optionalText(value: string | undefined, max: number, label: string): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length > max) throw invalid(`${label} must be at most ${max} characters.`);
  return trimmed || undefined;
}

/** Normalise and validate listing input. Shared by create and update. */
function cleanToolInput(input: ToolInput) {
  const name = input.name.trim();
  if (name.length < LIMITS.toolNameMin || name.length > LIMITS.toolNameMax) {
    throw invalid(`Tool name must be between ${LIMITS.toolNameMin} and ${LIMITS.toolNameMax} characters.`);
  }
  const description = input.description.trim();
  if (description.length < LIMITS.descriptionMin || description.length > LIMITS.descriptionMax) {
    throw invalid(`Description must be between ${LIMITS.descriptionMin} and ${LIMITS.descriptionMax} characters.`);
  }
  const pickupArea = input.pickupArea.trim();
  if (pickupArea.length < 2 || pickupArea.length > LIMITS.areaMax) {
    throw invalid("Pickup area must be between 2 and 80 characters.");
  }
  if (!isValidLatLng(input.pickupLocation)) throw invalid("Choose a valid pickup location on the map.");
  if (!Number.isInteger(input.maxLoanDays) || input.maxLoanDays < 1 || input.maxLoanDays > LIMITS.maxLoanDaysCeiling) {
    throw invalid(`Maximum loan length must be between 1 and ${LIMITS.maxLoanDaysCeiling} days.`);
  }
  if (input.depositAmount !== undefined && (!Number.isFinite(input.depositAmount) || input.depositAmount < 0 || input.depositAmount > 100000)) {
    throw invalid("Deposit must be a positive amount.");
  }
  if (input.availableFrom !== undefined && input.availableUntil !== undefined && input.availableUntil <= input.availableFrom) {
    throw invalid("Availability end must be after its start.");
  }
  return {
    name,
    description,
    pickupArea,
    category: input.category,
    condition: input.condition,
    maxLoanDays: input.maxLoanDays,
    depositAmount: input.depositAmount,
    availableFrom: input.availableFrom,
    availableUntil: input.availableUntil,
    pickupAddress: optionalText(input.pickupAddress, LIMITS.addressMax, "Pickup address"),
    instructions: optionalText(input.instructions, LIMITS.instructionsMax, "Lending instructions"),
    lendingTerms: optionalText(input.lendingTerms, LIMITS.termsMax, "Lending conditions"),
  };
}

async function requireOwnedTool(ctx: MutationCtx | QueryCtx, toolId: Id<"tools">, user: Doc<"users">) {
  const tool = await ctx.db.get(toolId);
  if (!tool || tool.removedAt !== undefined) throw notFound("Listing");
  if (tool.ownerId !== user._id && !isAdmin(user)) throw notFound("Listing");
  return tool;
}

/** Decline every pending request for a tool (used when it is unlisted or removed). */
async function declinePendingRequests(ctx: MutationCtx, tool: Doc<"tools">, reason: string, actorId: Id<"users">) {
  const pending = await ctx.db
    .query("borrowRequests")
    .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "PENDING"))
    .collect();
  const now = Date.now();
  for (const req of pending) {
    await ctx.db.patch(req._id, { status: "DECLINED", declineReason: reason, decidedAt: now, updatedAt: now });
    await writeAudit(ctx, {
      actorId,
      actorType: "USER",
      action: "request.declined",
      resourceType: "request",
      resourceId: req._id,
      fromStatus: "PENDING",
      toStatus: "DECLINED",
      meta: { automatic: true },
    });
    await notify(ctx, {
      userId: req.borrowerId,
      type: "REQUEST_DECLINED",
      title: "Request declined",
      body: `Your request for ${tool.name} was declined: ${reason}`,
      path: "/requests?tab=DECLINED",
      requestId: req._id,
      toolId: tool._id,
      toolName: tool.name,
      status: "DECLINED",
    });
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const create = mutation({
  args: { ...toolFields, isListed: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await requireActiveViewer(ctx);
    await enforceRateLimit(ctx, `tool:create:${user._id}`, RATE_LIMITS.createTool);
    const clean = cleanToolInput(args);
    await claimImages(ctx, user._id, args.imageIds, { min: 1, max: LIMITS.maxImages });
    const approx = approximateLocation(args.pickupLocation);
    const now = Date.now();
    const isListed = args.isListed ?? true;
    const toolId = await ctx.db.insert("tools", {
      ownerId: user._id,
      name: clean.name,
      category: clean.category,
      description: clean.description,
      condition: clean.condition,
      imageIds: args.imageIds,
      pickupArea: clean.pickupArea,
      approxLat: approx.lat,
      approxLng: approx.lng,
      instructions: clean.instructions,
      lendingTerms: clean.lendingTerms,
      depositAmount: clean.depositAmount,
      maxLoanDays: clean.maxLoanDays,
      availableFrom: clean.availableFrom,
      availableUntil: clean.availableUntil,
      isListed,
      status: isListed ? "AVAILABLE" : "UNAVAILABLE",
      discoverable: isListed,
      searchText: buildSearchText(clean),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("toolPickupLocations", {
      toolId,
      ownerId: user._id,
      lat: args.pickupLocation.lat,
      lng: args.pickupLocation.lng,
      address: clean.pickupAddress,
      updatedAt: now,
    });
    await bumpStats(ctx, user._id, { itemsListed: 1 });
    await recomputeToolStatus(ctx, toolId);
    await writeAudit(ctx, {
      actorId: user._id,
      actorType: "USER",
      action: "tool.created",
      resourceType: "tool",
      resourceId: toolId,
      toStatus: isListed ? "AVAILABLE" : "UNAVAILABLE",
    });
    return toolId;
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...args }) => {
    const user = await requireActiveViewer(ctx);
    const tool = await requireOwnedTool(ctx, toolId, user);
    const clean = cleanToolInput(args);
    await claimImages(ctx, tool.ownerId, args.imageIds, {
      min: 1,
      max: LIMITS.maxImages,
      alreadyAttached: tool.imageIds,
    });

    const location = await ctx.db
      .query("toolPickupLocations")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .unique();
    const moved =
      !location ||
      Math.abs(location.lat - args.pickupLocation.lat) > 1e-7 ||
      Math.abs(location.lng - args.pickupLocation.lng) > 1e-7;
    if (moved) {
      const open = await openLoansForTool(ctx, toolId);
      if (open.length > 0) {
        throw appError("INVALID_STATE", "The pickup location cannot change while a loan is reserved or in progress.");
      }
    }
    const approx = moved ? approximateLocation(args.pickupLocation) : { lat: tool.approxLat, lng: tool.approxLng };
    const now = Date.now();

    // Delete images that were dropped from the listing (only files the owner uploaded).
    const kept = new Set(args.imageIds);
    await releaseImages(
      ctx,
      tool.ownerId,
      tool.imageIds.filter((id) => !kept.has(id)),
    );

    await ctx.db.patch(toolId, {
      name: clean.name,
      category: clean.category,
      description: clean.description,
      condition: clean.condition,
      imageIds: args.imageIds,
      pickupArea: clean.pickupArea,
      approxLat: approx.lat,
      approxLng: approx.lng,
      instructions: clean.instructions,
      lendingTerms: clean.lendingTerms,
      depositAmount: clean.depositAmount,
      maxLoanDays: clean.maxLoanDays,
      availableFrom: clean.availableFrom,
      availableUntil: clean.availableUntil,
      searchText: buildSearchText(clean),
      updatedAt: now,
    });
    if (location) {
      await ctx.db.patch(location._id, {
        lat: args.pickupLocation.lat,
        lng: args.pickupLocation.lng,
        address: clean.pickupAddress,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("toolPickupLocations", {
        toolId,
        ownerId: tool.ownerId,
        lat: args.pickupLocation.lat,
        lng: args.pickupLocation.lng,
        address: clean.pickupAddress,
        updatedAt: now,
      });
    }
    await writeAudit(ctx, {
      actorId: user._id,
      actorType: user._id === tool.ownerId ? "USER" : "ADMIN",
      action: "tool.updated",
      resourceType: "tool",
      resourceId: toolId,
      meta: { locationChanged: moved },
    });
    return null;
  },
});

/** Owner toggles whether the tool is offered. Status itself is still derived. */
export const setListed = mutation({
  args: { toolId: v.id("tools"), listed: v.boolean() },
  handler: async (ctx, { toolId, listed }) => {
    const user = await requireActiveViewer(ctx);
    const tool = await requireOwnedTool(ctx, toolId, user);
    if (tool.ownerId !== user._id) throw forbidden("Only the owner can change availability.");
    if (tool.isListed === listed) return tool.status;
    await ctx.db.patch(toolId, { isListed: listed, updatedAt: Date.now() });
    if (!listed) await declinePendingRequests(ctx, tool, "The owner paused this listing.", user._id);
    const updated = await recomputeToolStatus(ctx, toolId);
    await writeAudit(ctx, {
      actorId: user._id,
      actorType: "USER",
      action: listed ? "tool.listed" : "tool.unlisted",
      resourceType: "tool",
      resourceId: toolId,
      fromStatus: tool.status,
      toStatus: updated?.status,
    });
    return updated?.status ?? tool.status;
  },
});

/** Soft-delete a listing. History (loans, feedback) keeps a snapshot of the name. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const user = await requireActiveViewer(ctx);
    const tool = await requireOwnedTool(ctx, toolId, user);
    if (tool.ownerId !== user._id) throw forbidden("Only the owner can delete this listing.");
    const open = await openLoansForTool(ctx, toolId);
    if (open.length > 0) {
      throw appError("INVALID_STATE", "This tool has a reserved or active loan. Finish or cancel it before deleting.");
    }
    await declinePendingRequests(ctx, tool, "The owner removed this listing.", user._id);
    const now = Date.now();
    await ctx.db.patch(toolId, { removedAt: now, removedBy: user._id, removedReason: "Deleted by owner", updatedAt: now });
    await bumpStats(ctx, tool.ownerId, { itemsListed: -1 });
    const updated = await recomputeToolStatus(ctx, toolId);
    await writeAudit(ctx, {
      actorId: user._id,
      actorType: "USER",
      action: "tool.removed",
      resourceType: "tool",
      resourceId: toolId,
      fromStatus: tool.status,
      toStatus: updated?.status,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const sortValidator = v.union(v.literal("nearest"), v.literal("recent"), v.literal("rating"));

/**
 * Map/sidebar discovery. Returns only approximate coordinates and safe owner
 * fields. The client sends a rounded centre; distances are approximate.
 */
export const discover = query({
  args: {
    center: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    radiusKm: v.optional(v.number()),
    category: v.optional(vToolCategory),
    conditions: v.optional(v.array(vToolCondition)),
    trustedOnly: v.optional(v.boolean()),
    availableNowOnly: v.optional(v.boolean()),
    search: v.optional(v.string()),
    sort: v.optional(sortValidator),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const viewer = await requireViewer(ctx);
    const limit = Math.min(Math.max(args.limit ?? 150, 1), 300);
    const center = args.center && isValidLatLng(args.center) ? args.center : null;
    const radiusKm =
      args.radiusKm !== undefined ? Math.min(Math.max(args.radiusKm, 0.5), MAX_DISCOVERY_RADIUS_KM) : null;
    const search = args.search?.trim().slice(0, 80) ?? "";

    let candidates: Doc<"tools">[];
    if (search.length >= 2) {
      candidates = await ctx.db
        .query("tools")
        .withSearchIndex("search_text", (q) => {
          const base = q.search("searchText", search).eq("discoverable", true);
          return args.category ? base.eq("category", args.category) : base;
        })
        .take(200);
    } else if (center && radiusKm !== null) {
      const box = boundingBox(center, radiusKm);
      candidates = (
        await ctx.db
          .query("tools")
          .withIndex("by_discoverable_lat", (q) =>
            q.eq("discoverable", true).gte("approxLat", box.minLat).lte("approxLat", box.maxLat),
          )
          .take(1500)
      ).filter((t) => inBox({ lat: t.approxLat, lng: t.approxLng }, box));
    } else {
      candidates = await ctx.db
        .query("tools")
        .withIndex("by_discoverable_created", (q) => q.eq("discoverable", true))
        .order("desc")
        .take(500);
    }

    const loadUser = userLoader(ctx);
    const rows = [];
    for (const tool of candidates) {
      // The viewer's own listings stay on the map (marked isMine) so owners can see them in context.
      if (args.category && tool.category !== args.category) continue;
      if (args.conditions && args.conditions.length > 0 && !args.conditions.includes(tool.condition)) continue;
      if (args.availableNowOnly && tool.status === "RESERVED") continue;
      const distanceKm = center ? haversineKm(center, { lat: tool.approxLat, lng: tool.approxLng }) : null;
      if (radiusKm !== null && distanceKm !== null && distanceKm > radiusKm) continue;
      const owner = await loadUser(tool.ownerId);
      if (!owner || owner.status !== "ACTIVE") continue;
      if (args.trustedOnly && !owner.trustedLender) continue;
      rows.push({ tool, owner, distanceKm });
    }

    const sort = args.sort ?? (center ? "nearest" : "recent");
    const ratingOf = (u: Doc<"users">) => (u.stats.ratingCount > 0 ? u.stats.ratingSum / u.stats.ratingCount : 0);
    rows.sort((a, b) => {
      if (sort === "nearest" && a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      if (sort === "rating") return ratingOf(b.owner) - ratingOf(a.owner) || b.tool.createdAt - a.tool.createdAt;
      return b.tool.createdAt - a.tool.createdAt;
    });

    const page = rows.slice(0, limit);
    const items = await Promise.all(
      page.map(async ({ tool, owner, distanceKm }) => ({
        ...(await toolCard(ctx, tool)),
        distanceKm,
        isMine: tool.ownerId === viewer._id,
        excerpt: tool.description.length > 160 ? `${tool.description.slice(0, 157).trimEnd()}…` : tool.description,
        maxLoanDays: tool.maxLoanDays,
        depositAmount: tool.depositAmount ?? null,
        owner: { ...userSummary(owner), areaLabel: owner.areaLabel ?? null },
      })),
    );

    // When nothing is nearby, suggest where listings exist so the map is never a dead end.
    let suggestion: { lat: number; lng: number; label: string } | null = null;
    if (items.length === 0 && center) {
      const any = await ctx.db
        .query("tools")
        .withIndex("by_discoverable_created", (q) => q.eq("discoverable", true))
        .order("desc")
        .first();
      if (any) suggestion = { lat: any.approxLat, lng: any.approxLng, label: any.pickupArea };
    }

    return { items, total: rows.length, truncated: rows.length > limit, suggestion };
  },
});

/** Full listing details for signed-in users. Never includes the exact location. */
export const get = query({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) return null;
    const isOwner = tool.ownerId === viewer._id;
    if (tool.removedAt !== undefined && !isOwner && !isAdmin(viewer)) return null;
    const owner = await ctx.db.get(tool.ownerId);
    if (!owner) return null;

    const open = await openLoansForTool(ctx, toolId);
    const bookedRanges = open
      .map((l) => ({ pickupAt: l.pickupAt, returnBy: l.returnBy }))
      .sort((a, b) => a.pickupAt - b.pickupAt);

    const myPending = await ctx.db
      .query("borrowRequests")
      .withIndex("by_borrower_tool_status", (q) =>
        q.eq("borrowerId", viewer._id).eq("toolId", toolId).eq("status", "PENDING"),
      )
      .first();
    const myLoan = open.find((l) => l.borrowerId === viewer._id) ?? null;
    const pendingCount = isOwner
      ? (
          await ctx.db
            .query("borrowRequests")
            .withIndex("by_tool_status", (q) => q.eq("toolId", toolId).eq("status", "PENDING"))
            .collect()
        ).length
      : null;

    return {
      ...(await toolCard(ctx, tool)),
      description: tool.description,
      images: await imageUrls(ctx, tool.imageIds),
      imageCredits: tool.imageCredits ?? [],
      instructions: tool.instructions ?? null,
      lendingTerms: tool.lendingTerms ?? null,
      depositAmount: tool.depositAmount ?? null,
      maxLoanDays: tool.maxLoanDays,
      availableFrom: tool.availableFrom ?? null,
      availableUntil: tool.availableUntil ?? null,
      discoverable: tool.discoverable,
      removed: tool.removedAt !== undefined,
      owner: {
        ...userSummary(owner),
        areaLabel: owner.areaLabel ?? null,
        reputation: computeReputation(owner.stats, owner.createdAt, Date.now()),
        active: owner.status === "ACTIVE",
      },
      bookedRanges,
      viewer: {
        isOwner,
        canRequest: !isOwner && tool.discoverable && viewer.status === "ACTIVE" && !myPending && !myLoan,
        pendingRequestId: myPending?._id ?? null,
        activeLoanId: myLoan?._id ?? null,
        pendingCount,
      },
    };
  },
});

/** The viewer's own listings with request counts. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (!viewer) return [];
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", viewer._id))
      .order("desc")
      .collect();
    const active = tools.filter((t) => t.removedAt === undefined);
    return Promise.all(
      active.map(async (tool) => {
        const pending = await ctx.db
          .query("borrowRequests")
          .withIndex("by_tool_status", (q) => q.eq("toolId", tool._id).eq("status", "PENDING"))
          .collect();
        const open = await openLoansForTool(ctx, tool._id);
        return {
          ...(await toolCard(ctx, tool)),
          isListed: tool.isListed,
          pendingRequests: pending.length,
          openLoans: open.map((l) => ({ id: l._id, status: l.status, pickupAt: l.pickupAt, returnBy: l.returnBy })),
          updatedAt: tool.updatedAt,
        };
      }),
    );
  },
});

/** Owner-only edit view, including the private pickup point. */
export const getForEdit = query({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const viewer = await requireViewer(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removedAt !== undefined || tool.ownerId !== viewer._id) return null;
    const location = await ctx.db
      .query("toolPickupLocations")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .unique();
    const urls = await Promise.all(tool.imageIds.map((id) => ctx.storage.getUrl(id)));
    return {
      id: tool._id,
      name: tool.name,
      category: tool.category,
      description: tool.description,
      condition: tool.condition,
      images: tool.imageIds.map((id, i) => ({ storageId: id, url: urls[i] ?? null })),
      pickupArea: tool.pickupArea,
      pickupLocation: location ? { lat: location.lat, lng: location.lng } : null,
      pickupAddress: location?.address ?? "",
      instructions: tool.instructions ?? "",
      lendingTerms: tool.lendingTerms ?? "",
      depositAmount: tool.depositAmount ?? null,
      maxLoanDays: tool.maxLoanDays,
      availableFrom: tool.availableFrom ?? null,
      availableUntil: tool.availableUntil ?? null,
      isListed: tool.isListed,
      status: tool.status,
    };
  },
});

/**
 * Anonymous landing-page preview. Returns an explicit allow-list of fields:
 * no owner identity, no exact location, no descriptions.
 */
export const publicPreview = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_discoverable_created", (q) => q.eq("discoverable", true))
      .order("desc")
      .take(120);
    const items = await Promise.all(
      tools.map(async (t) => {
        const [imageUrl] = await imageUrls(ctx, t.imageIds, 1);
        return {
          id: t._id,
          name: t.name,
          category: t.category,
          condition: t.condition,
          pickupArea: t.pickupArea,
          approxLat: t.approxLat,
          approxLng: t.approxLng,
          imageUrl: imageUrl ?? null,
          availableNow: t.status !== "RESERVED",
          isSeed: t.isSeed === true,
        };
      }),
    );
    const areas = new Set(items.map((i) => i.pickupArea.split(",")[0]!.trim()));
    return { items, stats: { tools: items.length, areas: areas.size } };
  },
});
