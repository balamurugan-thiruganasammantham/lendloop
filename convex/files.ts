import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { requireActiveViewer } from "./lib/auth";
import { ALLOWED_IMAGE_TYPES, LIMITS } from "./lib/constants";
import { forbidden, invalid } from "./lib/errors";
import { enforceRateLimit, RATE_LIMITS } from "./lib/rateLimit";

/** Short-lived upload URL for an image. Clients upload directly to Convex storage. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireActiveViewer(ctx);
    await enforceRateLimit(ctx, `upload:${user._id}`, RATE_LIMITS.uploadUrl);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Claim a freshly uploaded file. Must be called right after the upload; the
 * storage ID is not public until the file is attached somewhere, so nobody
 * else can claim it first. Validates content type and size server-side.
 * (The client also re-encodes images to strip EXIF/GPS metadata.)
 */
export const registerUpload = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const user = await requireActiveViewer(ctx);
    const existing = await ctx.db
      .query("uploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .unique();
    if (existing) {
      if (existing.ownerId !== user._id) throw forbidden("This file belongs to another user.");
      return null;
    }
    const meta = await ctx.db.system.get(storageId);
    if (!meta) throw invalid("The upload could not be found. Please try again.");
    const contentType = meta.contentType ?? "";
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType) || meta.size > LIMITS.maxImageBytes) {
      await ctx.storage.delete(storageId);
      return { rejected: true as const, message: "Images must be JPEG, PNG or WebP and at most 5 MB." };
    }
    await ctx.db.insert("uploads", {
      storageId,
      ownerId: user._id,
      contentType,
      size: meta.size,
      attached: false,
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * Validate a set of files the caller wants to attach: each must be an
 * image uploaded by this user (or already attached to the same record).
 * Marks them as attached.
 */
export async function claimImages(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  ids: readonly Id<"_storage">[],
  opts: { min: number; max: number; alreadyAttached?: readonly Id<"_storage">[] },
): Promise<void> {
  if (new Set(ids).size !== ids.length) throw invalid("Duplicate images were submitted.");
  if (ids.length < opts.min) throw invalid(opts.min === 1 ? "Add at least one photo." : `Add at least ${opts.min} photos.`);
  if (ids.length > opts.max) throw invalid(`You can attach at most ${opts.max} photos.`);
  const existing = new Set(opts.alreadyAttached ?? []);
  for (const id of ids) {
    if (existing.has(id)) continue;
    const upload = await ctx.db
      .query("uploads")
      .withIndex("by_storage", (q) => q.eq("storageId", id))
      .unique();
    if (!upload || upload.ownerId !== ownerId) throw invalid("One of the photos could not be verified. Please upload it again.");
    if (!upload.attached) await ctx.db.patch(upload._id, { attached: true });
  }
}

/** Delete files that were detached from a record, only if the caller owns them. */
export async function releaseImages(ctx: MutationCtx, ownerId: Id<"users">, ids: readonly Id<"_storage">[]): Promise<void> {
  for (const id of ids) {
    const upload = await ctx.db
      .query("uploads")
      .withIndex("by_storage", (q) => q.eq("storageId", id))
      .unique();
    if (!upload || upload.ownerId !== ownerId) continue;
    await ctx.db.delete(upload._id);
    await ctx.storage.delete(id);
  }
}
