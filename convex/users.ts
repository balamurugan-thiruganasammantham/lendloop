import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getViewer, requireActiveViewer, requireViewer } from "./lib/auth";
import { writeAudit } from "./lib/audit";
import { LIMITS } from "./lib/constants";
import { invalid, appError } from "./lib/errors";
import { coarsen, isValidLatLng } from "./lib/geo";
import { userSummary } from "./lib/projections";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimit";
import { computeReputation, EMPTY_STATS } from "./lib/rules";

/**
 * Create or refresh the Convex profile for the signed-in Clerk identity.
 * Called by the client after sign-in. Role is always USER on creation and is
 * never derived from client input or token claims.
 */
export const ensureCurrent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw appError("UNAUTHENTICATED", "Please sign in to continue.");
    const now = Date.now();
    const email = identity.email ?? "";
    const name = (identity.name ?? [identity.givenName, identity.familyName].filter(Boolean).join(" ")).trim();
    const imageUrl = identity.pictureUrl;
    const phoneVerified = identity.phoneNumberVerified === true;
    const phoneNumber = phoneVerified ? identity.phoneNumber : undefined;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      const patch: Partial<typeof existing> = {};
      if (email && email !== existing.email) patch.email = email;
      if (imageUrl && imageUrl !== existing.imageUrl) patch.imageUrl = imageUrl;
      if (phoneVerified !== existing.phoneVerified || phoneNumber !== existing.phoneNumber) {
        patch.phoneVerified = phoneVerified;
        patch.phoneNumber = phoneNumber;
      }
      if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
      return { userId: existing._id, onboarded: existing.onboardedAt !== undefined, created: false };
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      clerkUserId: identity.subject,
      email,
      name: name || email.split("@")[0] || "Neighbour",
      imageUrl,
      phoneNumber,
      phoneVerified,
      locationSharing: true,
      role: "USER",
      status: "ACTIVE",
      trustedLender: false,
      stats: EMPTY_STATS,
      createdAt: now,
      updatedAt: now,
    });
    await writeAudit(ctx, {
      actorId: userId,
      actorType: "USER",
      action: "user.created",
      resourceType: "user",
      resourceId: userId,
    });
    return { userId, onboarded: false, created: true };
  },
});

/** The viewer's own full profile (includes private fields that belong to them). */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getViewer(ctx);
    if (!user) return null;
    return {
      id: user._id,
      name: user.name,
      email: user.email,
      imageUrl: user.imageUrl ?? null,
      phoneNumber: user.phoneNumber ?? null,
      phoneVerified: user.phoneVerified,
      bio: user.bio ?? "",
      areaLabel: user.areaLabel ?? "",
      approxLat: user.approxLat ?? null,
      approxLng: user.approxLng ?? null,
      locationSharing: user.locationSharing,
      role: user.role,
      status: user.status,
      suspendedReason: user.suspendedReason ?? null,
      trustedLender: user.trustedLender,
      onboarded: user.onboardedAt !== undefined,
      createdAt: user.createdAt,
      stats: user.stats,
      reputation: computeReputation(user.stats, user.createdAt, Date.now()),
    };
  },
});

export const updateProfile = mutation({
  args: {
    name: v.string(),
    bio: v.optional(v.string()),
    areaLabel: v.optional(v.string()),
    approxLocation: v.optional(v.union(v.null(), v.object({ lat: v.number(), lng: v.number() }))),
    locationSharing: v.boolean(),
    completeOnboarding: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireViewer(ctx);
    await enforceRateLimit(ctx, `profile:${user._id}`, RATE_LIMITS.profileUpdate);
    const name = args.name.trim();
    if (name.length < 2 || name.length > LIMITS.nameMax) throw invalid("Name must be between 2 and 60 characters.");
    const bio = args.bio?.trim() ?? "";
    if (bio.length > LIMITS.bioMax) throw invalid(`Bio must be at most ${LIMITS.bioMax} characters.`);
    const areaLabel = args.areaLabel?.trim() ?? "";
    if (areaLabel.length > LIMITS.areaMax) throw invalid("Area must be at most 80 characters.");

    let approx: { lat: number; lng: number } | null | undefined = undefined;
    if (args.approxLocation === null) approx = null;
    else if (args.approxLocation) {
      if (!isValidLatLng(args.approxLocation)) throw invalid("Invalid location.");
      // Never store the precise point: coarsen to ~1 km.
      approx = coarsen(args.approxLocation, 2);
    }

    await ctx.db.patch(user._id, {
      name,
      bio: bio || undefined,
      areaLabel: areaLabel || undefined,
      ...(approx === null ? { approxLat: undefined, approxLng: undefined } : {}),
      ...(approx ? { approxLat: approx.lat, approxLng: approx.lng } : {}),
      locationSharing: args.locationSharing,
      ...(args.completeOnboarding && user.onboardedAt === undefined ? { onboardedAt: Date.now() } : {}),
      updatedAt: Date.now(),
    });
    await writeAudit(ctx, {
      actorId: user._id,
      actorType: "USER",
      action: args.completeOnboarding ? "user.onboarded" : "user.profile_updated",
      resourceType: "user",
      resourceId: user._id,
    });
    return null;
  },
});

/**
 * Reputation profile of another user, visible to signed-in members. Separates
 * platform-verified transaction facts from user-submitted feedback/claims.
 */
export const reputation = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireActiveViewer(ctx);
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const now = Date.now();
    const recentFeedback = await ctx.db
      .query("feedback")
      .withIndex("by_subject", (q) => q.eq("subjectId", userId))
      .order("desc")
      .take(30);
    const visible = recentFeedback.filter((f) => f.status !== "HIDDEN").slice(0, 10);
    const authors = await Promise.all(visible.map((f) => ctx.db.get(f.authorId)));
    const activeListings = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .filter((q) => q.eq(q.field("discoverable"), true))
      .take(12);
    return {
      user: {
        ...userSummary(user),
        bio: user.bio ?? null,
        areaLabel: user.areaLabel ?? null,
        status: user.status,
      },
      reputation: computeReputation(user.stats, user.createdAt, now),
      feedback: visible.map((f, i) => ({
        id: f._id,
        rating: f.rating,
        comment: f.comment ?? null,
        tags: f.tags,
        direction: f.direction,
        createdAt: f.createdAt,
        author: authors[i] ? userSummary(authors[i]!) : null,
        underReview: f.status === "REPORTED",
      })),
      listings: activeListings.map((t) => ({ id: t._id, name: t.name, category: t.category, status: t.status })),
    };
  },
});
