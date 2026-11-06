/**
 * Explicit projections from database documents to client-safe shapes.
 * Queries must return these instead of raw documents so that private fields
 * (email, phone, exact coordinates, OTP hashes, internal flags) can never
 * leak by accident when the schema grows.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { computeReputation } from "./rules";

/** "Arun Kumar" → "Arun K." */
export function displayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Neighbour";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

export interface UserSummary {
  id: Id<"users">;
  name: string;
  imageUrl: string | null;
  trustedLender: boolean;
  averageRating: number | null;
  reviewCount: number;
  memberSince: number;
  isSeed: boolean;
}

export function userSummary(user: Doc<"users">): UserSummary {
  const rep = computeReputation(user.stats, user.createdAt, Date.now());
  return {
    id: user._id,
    name: displayName(user.name),
    imageUrl: user.imageUrl ?? null,
    trustedLender: user.trustedLender,
    averageRating: rep.averageRating,
    reviewCount: rep.reviewCount,
    memberSince: user.createdAt,
    isSeed: user.isSeed === true,
  };
}

export async function imageUrls(ctx: QueryCtx, ids: readonly Id<"_storage">[], max = ids.length): Promise<string[]> {
  const urls = await Promise.all(ids.slice(0, max).map((id) => ctx.storage.getUrl(id)));
  return urls.filter((u): u is string => typeof u === "string");
}

export interface ToolCard {
  id: Id<"tools">;
  name: string;
  category: Doc<"tools">["category"];
  condition: Doc<"tools">["condition"];
  status: Doc<"tools">["status"];
  pickupArea: string;
  approxLat: number;
  approxLng: number;
  imageUrl: string | null;
  createdAt: number;
  isSeed: boolean;
}

export async function toolCard(ctx: QueryCtx, tool: Doc<"tools">): Promise<ToolCard> {
  const [first] = await imageUrls(ctx, tool.imageIds, 1);
  return {
    id: tool._id,
    name: tool.name,
    category: tool.category,
    condition: tool.condition,
    status: tool.status,
    pickupArea: tool.pickupArea,
    approxLat: tool.approxLat,
    approxLng: tool.approxLng,
    imageUrl: first ?? null,
    createdAt: tool.createdAt,
    isSeed: tool.isSeed === true,
  };
}

/** Memoising user loader to avoid refetching the same owner for many rows. */
export function userLoader(ctx: QueryCtx) {
  const cache = new Map<Id<"users">, Promise<Doc<"users"> | null>>();
  return (id: Id<"users">) => {
    let p = cache.get(id);
    if (!p) {
      p = ctx.db.get(id);
      cache.set(id, p);
    }
    return p;
  };
}
