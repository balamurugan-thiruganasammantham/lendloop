import { v, type VLiteral, type VUnion } from "convex/values";
import {
  ACCOUNT_STATUSES,
  DAMAGE_REPORT_STATUSES,
  DISPUTE_OUTCOMES,
  FEEDBACK_TAGS,
  LOAN_STATUSES,
  NOTIFICATION_TYPES,
  OTP_PURPOSES,
  REQUEST_STATUSES,
  TOOL_CATEGORIES,
  TOOL_CONDITIONS,
  TOOL_STATUSES,
  USER_ROLES,
} from "../lib/constants";

/** Build a `v.union(v.literal(...))` validator from a readonly tuple of string literals. */
export function literals<const T extends readonly [string, ...string[]]>(
  values: T,
): VUnion<T[number], VLiteral<T[number], "required">[], "required", never> {
  const members = values.map((value) => v.literal(value));
  return v.union(...members) as unknown as VUnion<T[number], VLiteral<T[number], "required">[], "required", never>;
}

export const vToolCategory = literals(TOOL_CATEGORIES);
export const vToolCondition = literals(TOOL_CONDITIONS);
export const vToolStatus = literals(TOOL_STATUSES);
export const vRequestStatus = literals(REQUEST_STATUSES);
export const vLoanStatus = literals(LOAN_STATUSES);
export const vUserRole = literals(USER_ROLES);
export const vAccountStatus = literals(ACCOUNT_STATUSES);
export const vOtpPurpose = literals(OTP_PURPOSES);
export const vFeedbackTag = literals(FEEDBACK_TAGS);
export const vNotificationType = literals(NOTIFICATION_TYPES);
export const vDamageReportStatus = literals(DAMAGE_REPORT_STATUSES);
export const vDisputeOutcome = literals(DISPUTE_OUTCOMES);

export const vActorType = literals(["USER", "ADMIN", "SYSTEM", "AUTOMATION"] as const);
export const vFeedbackDirection = literals(["BORROWER_TO_OWNER", "OWNER_TO_BORROWER"] as const);
export const vFeedbackStatus = literals(["VISIBLE", "REPORTED", "HIDDEN"] as const);
export const vReportTarget = literals(["FEEDBACK", "USER", "TOOL"] as const);
export const vReportStatus = literals(["OPEN", "DISMISSED", "ACTIONED"] as const);
export const vOtpStatus = literals(["ACTIVE", "CONSUMED", "SUPERSEDED", "LOCKED"] as const);
export const vAutomationStatus = literals([
  "PENDING",
  "DELIVERED",
  "FAILED",
  "DEAD",
  "SKIPPED",
] as const);
export const vDeliveryResult = literals(["SENT", "MOCKED", "FAILED", "SKIPPED"] as const);
export const vReminderStatus = literals(["CLAIMED", "SENT", "MOCKED", "FAILED"] as const);

export const vStats = v.object({
  itemsListed: v.number(),
  lendingTotal: v.number(),
  lendingCompleted: v.number(),
  borrowingTotal: v.number(),
  borrowingCompleted: v.number(),
  lateReturns: v.number(),
  damageReportsReceived: v.number(),
  damageReportsVerified: v.number(),
  notReturnedReports: v.number(),
  notReturnedVerified: v.number(),
  ratingSum: v.number(),
  ratingCount: v.number(),
});

/** Audit metadata: flat, non-sensitive key/value pairs only. */
export const vAuditMeta = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()));

export const vAutomationPayload = v.object({
  title: v.string(),
  body: v.string(),
  path: v.string(),
  toolName: v.optional(v.string()),
  status: v.optional(v.string()),
});
