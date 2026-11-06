import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type ActorType = "USER" | "ADMIN" | "SYSTEM" | "AUTOMATION";
type MetaValue = string | number | boolean | null;

/** Key segments that must never be written to the audit log. */
const FORBIDDEN_SEGMENTS = new Set([
  "otp",
  "code",
  "token",
  "secret",
  "password",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "address",
  "email",
  "phone",
]);

/** Split "pickupLat" / "otp_code" into ["pickup", "lat"] / ["otp", "code"]. */
function keySegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);
}

export function isForbiddenMetaKey(key: string): boolean {
  return keySegments(key).some((s) => FORBIDDEN_SEGMENTS.has(s));
}

export interface AuditEntry {
  actorId?: Id<"users">;
  actorType: ActorType;
  action: string;
  resourceType: "user" | "tool" | "request" | "loan" | "feedback" | "damageReport" | "userReport" | "automation";
  resourceId: string;
  fromStatus?: string;
  toStatus?: string;
  meta?: Record<string, MetaValue>;
}

export function sanitizeAuditMeta(meta: Record<string, MetaValue> | undefined): Record<string, MetaValue> | undefined {
  if (!meta) return undefined;
  const clean: Record<string, MetaValue> = {};
  for (const [k, value] of Object.entries(meta)) {
    if (isForbiddenMetaKey(k)) continue;
    clean[k] = typeof value === "string" ? value.slice(0, 300) : value;
  }
  return clean;
}

export async function writeAudit(ctx: MutationCtx, entry: AuditEntry): Promise<void> {
  await ctx.db.insert("auditLogs", {
    actorId: entry.actorId,
    actorType: entry.actorType,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    meta: sanitizeAuditMeta(entry.meta),
    createdAt: Date.now(),
  });
}
