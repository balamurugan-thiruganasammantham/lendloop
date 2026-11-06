import { describe, expect, it } from "vitest";
import { LOAN_STATUSES, REQUEST_STATUSES } from "@convex/lib/constants";
import {
  assertLoanTransition,
  borrowerTabFor,
  canTransitionLoan,
  canTransitionRequest,
  deriveToolStatus,
  isDiscoverableStatus,
  LOAN_TRANSITIONS,
  TransitionError,
} from "@convex/lib/stateMachine";

describe("loan state machine", () => {
  it("allows the happy path with the right actors", () => {
    const path: [string, string, "OWNER" | "BORROWER" | "SYSTEM"][] = [
      ["APPROVED", "COLLECTION_OTP_PENDING", "SYSTEM"],
      ["COLLECTION_OTP_PENDING", "COLLECTED", "OWNER"],
      ["COLLECTED", "ACTIVE_LOAN", "SYSTEM"],
      ["ACTIVE_LOAN", "RETURN_REQUESTED", "BORROWER"],
      ["RETURN_REQUESTED", "RETURN_VERIFICATION_PENDING", "OWNER"],
      ["RETURN_VERIFICATION_PENDING", "RETURNED", "OWNER"],
      ["RETURNED", "COMPLETED", "SYSTEM"],
    ];
    for (const [from, to, actor] of path) {
      expect(canTransitionLoan(from as never, to as never, actor)).toBe(true);
    }
  });

  it("never lets the borrower confirm their own collection or return", () => {
    expect(canTransitionLoan("COLLECTION_OTP_PENDING", "COLLECTED", "BORROWER")).toBe(false);
    expect(canTransitionLoan("RETURN_VERIFICATION_PENDING", "RETURNED", "BORROWER")).toBe(false);
  });

  it("does not let users skip verification", () => {
    expect(canTransitionLoan("APPROVED", "ACTIVE_LOAN", "OWNER")).toBe(false);
    expect(canTransitionLoan("ACTIVE_LOAN", "COMPLETED", "OWNER")).toBe(false);
    expect(canTransitionLoan("RETURN_REQUESTED", "RETURNED", "OWNER")).toBe(false);
  });

  it("treats COMPLETED and CANCELLED as terminal", () => {
    for (const to of LOAN_STATUSES) {
      for (const actor of ["OWNER", "BORROWER", "ADMIN", "SYSTEM"] as const) {
        expect(canTransitionLoan("COMPLETED", to, actor)).toBe(false);
        expect(canTransitionLoan("CANCELLED", to, actor)).toBe(false);
      }
    }
  });

  it("only allows cancellation before pickup", () => {
    expect(canTransitionLoan("APPROVED", "CANCELLED", "BORROWER")).toBe(true);
    expect(canTransitionLoan("COLLECTION_OTP_PENDING", "CANCELLED", "OWNER")).toBe(true);
    expect(canTransitionLoan("ACTIVE_LOAN", "CANCELLED", "OWNER")).toBe(false);
    expect(canTransitionLoan("ACTIVE_LOAN", "CANCELLED", "BORROWER")).toBe(false);
  });

  it("restricts dispute resolution to admins", () => {
    expect(canTransitionLoan("DISPUTED", "COMPLETED", "ADMIN")).toBe(true);
    expect(canTransitionLoan("DISPUTED", "COMPLETED", "OWNER")).toBe(false);
    expect(canTransitionLoan("DISPUTED", "ACTIVE_LOAN", "BORROWER")).toBe(false);
  });

  it("has a transition table entry for every status", () => {
    expect(Object.keys(LOAN_TRANSITIONS).sort()).toEqual([...LOAN_STATUSES].sort());
  });

  it("assertLoanTransition throws a TransitionError", () => {
    expect(() => assertLoanTransition("APPROVED", "COMPLETED", "OWNER")).toThrow(TransitionError);
  });
});

describe("request state machine", () => {
  it("only pending requests change state", () => {
    for (const from of REQUEST_STATUSES.filter((s) => s !== "PENDING")) {
      for (const to of REQUEST_STATUSES) {
        expect(canTransitionRequest(from, to, "OWNER")).toBe(false);
      }
    }
  });
  it("only the owner approves; only the borrower cancels", () => {
    expect(canTransitionRequest("PENDING", "APPROVED", "OWNER")).toBe(true);
    expect(canTransitionRequest("PENDING", "APPROVED", "BORROWER")).toBe(false);
    expect(canTransitionRequest("PENDING", "CANCELLED", "BORROWER")).toBe(true);
    expect(canTransitionRequest("PENDING", "CANCELLED", "OWNER")).toBe(false);
  });
});

describe("deriveToolStatus", () => {
  const base = { removed: false, listed: true, ownerActive: true, openLoanStatuses: [], hasPendingRequests: false } as const;

  it("is AVAILABLE by default", () => expect(deriveToolStatus(base)).toBe("AVAILABLE"));
  it("reflects pending requests without blocking discovery", () => {
    const s = deriveToolStatus({ ...base, hasPendingRequests: true });
    expect(s).toBe("PENDING_REQUEST");
    expect(isDiscoverableStatus(s)).toBe(true);
  });
  it("is RESERVED for approved, uncollected loans", () => {
    expect(deriveToolStatus({ ...base, openLoanStatuses: ["COLLECTION_OTP_PENDING"] })).toBe("RESERVED");
  });
  it("is LENT while the borrower holds the tool, and leaves discovery", () => {
    const s = deriveToolStatus({ ...base, openLoanStatuses: ["ACTIVE_LOAN"], hasPendingRequests: true });
    expect(s).toBe("LENT");
    expect(isDiscoverableStatus(s)).toBe(false);
  });
  it("is RETURN_PENDING during hand-back or disputes", () => {
    expect(deriveToolStatus({ ...base, openLoanStatuses: ["DISPUTED"] })).toBe("RETURN_PENDING");
  });
  it("possession wins over the owner's unlist toggle", () => {
    expect(deriveToolStatus({ ...base, listed: false, openLoanStatuses: ["OVERDUE"] })).toBe("LENT");
  });
  it("is UNAVAILABLE when unlisted or the owner is suspended", () => {
    expect(deriveToolStatus({ ...base, listed: false })).toBe("UNAVAILABLE");
    expect(deriveToolStatus({ ...base, ownerActive: false, hasPendingRequests: true })).toBe("UNAVAILABLE");
  });
  it("REMOVED wins over everything", () => {
    expect(deriveToolStatus({ ...base, removed: true, openLoanStatuses: ["ACTIVE_LOAN"] })).toBe("REMOVED");
  });
});

describe("borrowerTabFor", () => {
  it.each([
    ["PENDING", null, "PENDING"],
    ["DECLINED", null, "DECLINED"],
    ["EXPIRED", null, "CANCELLED"],
    ["APPROVED", "COLLECTION_OTP_PENDING", "APPROVED"],
    ["APPROVED", "OVERDUE", "ACTIVE"],
    ["APPROVED", "RETURN_REQUESTED", "RETURN_PENDING"],
    ["APPROVED", "DISPUTED", "RETURN_PENDING"],
    ["APPROVED", "COMPLETED", "COMPLETED"],
    ["APPROVED", "CANCELLED", "CANCELLED"],
  ] as const)("%s/%s → %s", (req, loan, tab) => {
    expect(borrowerTabFor(req, loan)).toBe(tab);
  });
});
