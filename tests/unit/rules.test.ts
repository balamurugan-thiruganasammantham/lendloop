import { describe, expect, it } from "vitest";
import { OTP_CONFIG, TIME } from "@convex/lib/constants";
import {
  AUTOMATION_MAX_ATTEMPTS,
  collectionOtpExpiry,
  computeReputation,
  EMPTY_STATS,
  feedbackEligibility,
  findConflict,
  isLateReturn,
  rangesOverlap,
  reminderKey,
  reminderPeriod,
  retryDelayMs,
  validateBorrowWindow,
  validateFeedbackTags,
} from "@convex/lib/rules";

const NOW = Date.UTC(2026, 10, 5, 9, 0, 0);

describe("validateBorrowWindow", () => {
  const ok = { pickupAt: NOW + TIME.day, returnBy: NOW + 2 * TIME.day, now: NOW, maxLoanDays: 3 };

  it("accepts a valid window", () => expect(validateBorrowWindow(ok)).toEqual({ ok: true }));

  it("rejects a start in the past", () => {
    const r = validateBorrowWindow({ ...ok, pickupAt: NOW - TIME.hour });
    expect(r).toMatchObject({ ok: false, code: "START_IN_PAST" });
  });

  it("tolerates a few minutes of clock skew", () => {
    expect(validateBorrowWindow({ ...ok, pickupAt: NOW - 2 * TIME.minute }).ok).toBe(true);
  });

  it("rejects an end before (or equal to) the start", () => {
    expect(validateBorrowWindow({ ...ok, returnBy: ok.pickupAt })).toMatchObject({ code: "END_BEFORE_START" });
    expect(validateBorrowWindow({ ...ok, returnBy: ok.pickupAt - 1 })).toMatchObject({ code: "END_BEFORE_START" });
  });

  it("enforces the maximum loan length", () => {
    expect(validateBorrowWindow({ ...ok, returnBy: ok.pickupAt + 4 * TIME.day })).toMatchObject({ code: "TOO_LONG" });
  });

  it("respects the owner's availability window", () => {
    expect(validateBorrowWindow({ ...ok, availableFrom: NOW + 3 * TIME.day })).toMatchObject({ code: "OUTSIDE_AVAILABILITY" });
    expect(validateBorrowWindow({ ...ok, availableUntil: NOW + TIME.day + TIME.hour })).toMatchObject({
      code: "OUTSIDE_AVAILABILITY",
    });
  });

  it("rejects requests too far ahead and non-finite input", () => {
    expect(validateBorrowWindow({ ...ok, pickupAt: NOW + 100 * TIME.day, returnBy: NOW + 101 * TIME.day })).toMatchObject({
      code: "TOO_FAR_AHEAD",
    });
    expect(validateBorrowWindow({ ...ok, pickupAt: Number.NaN })).toMatchObject({ code: "INVALID_DATES" });
  });
});

describe("overlap detection", () => {
  it("treats ranges as half-open (back-to-back bookings are fine)", () => {
    expect(rangesOverlap(0, 10, 10, 20)).toBe(false);
    expect(rangesOverlap(0, 10, 9, 20)).toBe(true);
    expect(rangesOverlap(5, 6, 0, 10)).toBe(true);
  });
  it("finds the conflicting booking", () => {
    const booked = [
      { id: "a", pickupAt: 0, returnBy: 10 },
      { id: "b", pickupAt: 20, returnBy: 30 },
    ];
    expect(findConflict({ pickupAt: 10, returnBy: 20 }, booked)).toBeNull();
    expect(findConflict({ pickupAt: 25, returnBy: 40 }, booked)?.id).toBe("b");
  });
});

describe("lateness and OTP expiry", () => {
  it("allows a one-hour grace period", () => {
    expect(isLateReturn(NOW, NOW + 59 * TIME.minute)).toBe(false);
    expect(isLateReturn(NOW, NOW + 61 * TIME.minute)).toBe(true);
  });

  it("keeps collection codes valid through the pickup day but caps the lifetime", () => {
    expect(collectionOtpExpiry(NOW, NOW + TIME.day)).toBe(NOW + 2 * TIME.day);
    expect(collectionOtpExpiry(NOW, NOW + 30 * TIME.day)).toBe(NOW + OTP_CONFIG.collectionMaxTtlMs);
    expect(collectionOtpExpiry(NOW, NOW - 3 * TIME.day)).toBe(NOW + OTP_CONFIG.minTtlMs);
  });
});

describe("computeReputation", () => {
  it("returns nulls for a new account", () => {
    const r = computeReputation(EMPTY_STATS, NOW - 3 * TIME.day, NOW);
    expect(r.averageRating).toBeNull();
    expect(r.onTimeRate).toBeNull();
    expect(r.accountAgeDays).toBe(3);
  });

  it("separates verified incidents from unverified claims", () => {
    const r = computeReputation(
      {
        ...EMPTY_STATS,
        borrowingCompleted: 4,
        lateReturns: 1,
        damageReportsReceived: 3,
        damageReportsVerified: 1,
        notReturnedReports: 1,
        ratingSum: 18,
        ratingCount: 4,
      },
      NOW,
      NOW,
    );
    expect(r.averageRating).toBe(4.5);
    expect(r.onTimeRate).toBe(0.75);
    expect(r.verified.damageIncidentsConfirmed).toBe(1);
    expect(r.unverified.openDamageReports).toBe(2);
    expect(r.unverified.openNotReturnedReports).toBe(1);
  });
});

describe("feedback rules", () => {
  const base = { loanStatus: "COMPLETED" as const, viewerIsBorrower: true, viewerIsOwner: false, alreadySubmitted: false };
  it("requires a completed loan", () => {
    expect(feedbackEligibility({ ...base, loanStatus: "ACTIVE_LOAN" })).toMatchObject({ ok: false, code: "NOT_COMPLETED" });
  });
  it("requires participation", () => {
    expect(feedbackEligibility({ ...base, viewerIsBorrower: false })).toMatchObject({ code: "NOT_PARTICIPANT" });
  });
  it("prevents duplicates", () => {
    expect(feedbackEligibility({ ...base, alreadySubmitted: true })).toMatchObject({ code: "DUPLICATE" });
  });
  it("allows a first review of a completed loan", () => {
    expect(feedbackEligibility(base)).toEqual({ ok: true });
  });
  it("rejects tags that do not fit the direction", () => {
    expect(validateFeedbackTags("BORROWER_TO_OWNER", ["RETURNED_LATE"]).ok).toBe(false);
    expect(validateFeedbackTags("OWNER_TO_BORROWER", ["ITEM_AS_DESCRIBED"]).ok).toBe(false);
    expect(validateFeedbackTags("OWNER_TO_BORROWER", ["RETURNED_LATE", "COMMUNICATED_WELL"]).ok).toBe(true);
    expect(validateFeedbackTags("OWNER_TO_BORROWER", ["COMMUNICATED_WELL", "COMMUNICATED_WELL"]).ok).toBe(false);
  });
});

describe("automation idempotency helpers", () => {
  it("derives one reminder key per loan per UTC day", () => {
    expect(reminderPeriod(Date.UTC(2026, 10, 5, 23, 59))).toBe("2026-11-05");
    expect(reminderPeriod(Date.UTC(2026, 10, 6, 0, 1))).toBe("2026-11-06");
    expect(reminderKey("abc", "2026-11-05")).toBe("overdue:abc:2026-11-05");
  });

  it("backs off exponentially with jitter and stops after the last attempt", () => {
    const mid = () => 0.5;
    expect(retryDelayMs(1, mid)).toBe(30_000);
    expect(retryDelayMs(2, mid)).toBe(120_000);
    expect(retryDelayMs(AUTOMATION_MAX_ATTEMPTS, mid)).toBeNull();
    const low = retryDelayMs(1, () => 0)!;
    const high = retryDelayMs(1, () => 0.999)!;
    expect(low).toBeGreaterThanOrEqual(24_000);
    expect(high).toBeLessThanOrEqual(36_000);
  });
});
