/**
 * Pure business rules: borrow window validation, overlap detection,
 * lateness, reputation and feedback eligibility.
 */
import { LATE_RETURN_GRACE_MS, LIMITS, OTP_CONFIG, TIME, type FeedbackTag, type LoanStatus } from "./constants";
import { BORROWER_ONLY_TAGS, OWNER_ONLY_TAGS } from "./constants";

export type RuleResult = { ok: true } | { ok: false; code: string; message: string };

const fail = (code: string, message: string): RuleResult => ({ ok: false, code, message });

/** Half-open interval overlap: [aStart, aEnd) ∩ [bStart, bEnd) ≠ ∅. */
export function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface BorrowWindowInput {
  pickupAt: number;
  returnBy: number;
  now: number;
  maxLoanDays: number;
  availableFrom?: number | null;
  availableUntil?: number | null;
}

/** Small tolerance so a request submitted for "now" is not rejected by clock skew. */
const PAST_TOLERANCE_MS = 5 * TIME.minute;

export function validateBorrowWindow(input: BorrowWindowInput): RuleResult {
  const { pickupAt, returnBy, now, maxLoanDays } = input;
  if (!Number.isFinite(pickupAt) || !Number.isFinite(returnBy)) {
    return fail("INVALID_DATES", "Pick-up and return times are required.");
  }
  if (pickupAt < now - PAST_TOLERANCE_MS) {
    return fail("START_IN_PAST", "The pick-up time cannot be in the past.");
  }
  if (returnBy <= pickupAt) {
    return fail("END_BEFORE_START", "The return time must be after the pick-up time.");
  }
  if (pickupAt > now + 90 * TIME.day) {
    return fail("TOO_FAR_AHEAD", "Requests can be made up to 90 days in advance.");
  }
  const maxMs = Math.min(maxLoanDays, LIMITS.maxLoanDaysCeiling) * TIME.day;
  if (returnBy - pickupAt > maxMs) {
    return fail("TOO_LONG", `This tool can be borrowed for at most ${maxLoanDays} day${maxLoanDays === 1 ? "" : "s"}.`);
  }
  if (input.availableFrom != null && pickupAt < input.availableFrom) {
    return fail("OUTSIDE_AVAILABILITY", "The owner has not made this tool available for those dates yet.");
  }
  if (input.availableUntil != null && returnBy > input.availableUntil) {
    return fail("OUTSIDE_AVAILABILITY", "The return date is after the owner's availability window.");
  }
  return { ok: true };
}

export interface BookedRange {
  pickupAt: number;
  returnBy: number;
}

export function findConflict<T extends BookedRange>(range: BookedRange, booked: readonly T[]): T | null {
  return booked.find((b) => rangesOverlap(range.pickupAt, range.returnBy, b.pickupAt, b.returnBy)) ?? null;
}

/** A return is late when the borrower initiated it after the agreed time plus a grace period. */
export function isLateReturn(returnBy: number, returnInitiatedAt: number, graceMs = LATE_RETURN_GRACE_MS): boolean {
  return returnInitiatedAt > returnBy + graceMs;
}

export function collectionOtpExpiry(now: number, pickupAt: number): number {
  const target = pickupAt + OTP_CONFIG.collectionGraceMs;
  return Math.min(now + OTP_CONFIG.collectionMaxTtlMs, Math.max(now + OTP_CONFIG.minTtlMs, target));
}

// ---------------------------------------------------------------------------
// Reputation
// ---------------------------------------------------------------------------

export interface UserStats {
  itemsListed: number;
  lendingTotal: number;
  lendingCompleted: number;
  borrowingTotal: number;
  borrowingCompleted: number;
  lateReturns: number;
  damageReportsReceived: number;
  damageReportsVerified: number;
  notReturnedReports: number;
  notReturnedVerified: number;
  ratingSum: number;
  ratingCount: number;
}

export const EMPTY_STATS: UserStats = {
  itemsListed: 0,
  lendingTotal: 0,
  lendingCompleted: 0,
  borrowingTotal: 0,
  borrowingCompleted: 0,
  lateReturns: 0,
  damageReportsReceived: 0,
  damageReportsVerified: 0,
  notReturnedReports: 0,
  notReturnedVerified: 0,
  ratingSum: 0,
  ratingCount: 0,
};

export interface Reputation {
  /** Average rating rounded to one decimal, or null when there are no reviews. */
  averageRating: number | null;
  reviewCount: number;
  /** Facts recorded by the platform from completed transactions. */
  verified: {
    completedTransactions: number;
    borrowingTotal: number;
    successfulReturns: number;
    lendingTotal: number;
    successfulLends: number;
    lateReturns: number;
    damageIncidentsConfirmed: number;
    notReturnedConfirmed: number;
  };
  /** Claims made by other users that have not been confirmed. */
  unverified: {
    openDamageReports: number;
    openNotReturnedReports: number;
  };
  accountAgeDays: number;
  /** On-time return rate across completed borrows, or null when unknown. */
  onTimeRate: number | null;
}

export function computeReputation(stats: UserStats, createdAt: number, now: number): Reputation {
  const averageRating = stats.ratingCount > 0 ? Math.round((stats.ratingSum / stats.ratingCount) * 10) / 10 : null;
  const onTimeRate =
    stats.borrowingCompleted > 0
      ? Math.max(0, Math.round(((stats.borrowingCompleted - stats.lateReturns) / stats.borrowingCompleted) * 100) / 100)
      : null;
  return {
    averageRating,
    reviewCount: stats.ratingCount,
    verified: {
      completedTransactions: stats.borrowingCompleted + stats.lendingCompleted,
      borrowingTotal: stats.borrowingTotal,
      successfulReturns: stats.borrowingCompleted,
      lendingTotal: stats.lendingTotal,
      successfulLends: stats.lendingCompleted,
      lateReturns: stats.lateReturns,
      damageIncidentsConfirmed: stats.damageReportsVerified,
      notReturnedConfirmed: stats.notReturnedVerified,
    },
    unverified: {
      openDamageReports: Math.max(0, stats.damageReportsReceived - stats.damageReportsVerified),
      openNotReturnedReports: Math.max(0, stats.notReturnedReports - stats.notReturnedVerified),
    },
    accountAgeDays: Math.max(0, Math.floor((now - createdAt) / TIME.day)),
    onTimeRate,
  };
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export type FeedbackDirection = "BORROWER_TO_OWNER" | "OWNER_TO_BORROWER";

export function feedbackEligibility(params: {
  loanStatus: LoanStatus;
  viewerIsBorrower: boolean;
  viewerIsOwner: boolean;
  alreadySubmitted: boolean;
}): RuleResult {
  if (!params.viewerIsBorrower && !params.viewerIsOwner) {
    return fail("NOT_PARTICIPANT", "Only the borrower and owner of this loan can leave feedback.");
  }
  if (params.loanStatus !== "COMPLETED") {
    return fail("NOT_COMPLETED", "Feedback opens once the loan is completed.");
  }
  if (params.alreadySubmitted) {
    return fail("DUPLICATE", "You have already left feedback for this loan.");
  }
  return { ok: true };
}

export function validateFeedbackTags(direction: FeedbackDirection, tags: readonly FeedbackTag[]): RuleResult {
  if (new Set(tags).size !== tags.length) return fail("DUPLICATE_TAGS", "Tags must be unique.");
  if (tags.length > 5) return fail("TOO_MANY_TAGS", "Choose up to five tags.");
  const disallowed = direction === "BORROWER_TO_OWNER" ? OWNER_ONLY_TAGS : BORROWER_ONLY_TAGS;
  const bad = tags.find((t) => disallowed.includes(t));
  if (bad) return fail("TAG_NOT_ALLOWED", "One of the selected tags does not apply to this review.");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Automation idempotency
// ---------------------------------------------------------------------------

/** Reminder period = UTC calendar day; one reminder per loan per day. */
export function reminderPeriod(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function reminderKey(loanId: string, period: string): string {
  return `overdue:${loanId}:${period}`;
}

/** Exponential backoff for outbound webhook retries, with ±20% jitter. */
export const AUTOMATION_RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
export const AUTOMATION_MAX_ATTEMPTS = AUTOMATION_RETRY_DELAYS_MS.length + 1;

export function retryDelayMs(attempt: number, random: () => number = Math.random): number | null {
  const base = AUTOMATION_RETRY_DELAYS_MS[attempt - 1];
  if (base === undefined) return null;
  return Math.round(base * (0.8 + random() * 0.4));
}
