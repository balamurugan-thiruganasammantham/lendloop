/**
 * Borrow request and loan lifecycle state machines.
 *
 * These are pure functions/data so they can be unit tested and reused by the
 * UI to decide which actions to offer. The backend is the only place that
 * actually applies transitions; every mutation calls `assertLoanTransition`.
 */
import type { LoanStatus, RequestStatus, ToolStatus } from "./constants";

export type LifecycleActor = "BORROWER" | "OWNER" | "ADMIN" | "SYSTEM";

type TransitionTable<S extends string> = Record<S, Partial<Record<S, readonly LifecycleActor[]>>>;

export const REQUEST_TRANSITIONS: TransitionTable<RequestStatus> = {
  PENDING: {
    APPROVED: ["OWNER"],
    DECLINED: ["OWNER", "SYSTEM"],
    CANCELLED: ["BORROWER", "ADMIN", "SYSTEM"],
    EXPIRED: ["SYSTEM"],
  },
  APPROVED: {},
  DECLINED: {},
  CANCELLED: {},
  EXPIRED: {},
};

/**
 * Loan lifecycle:
 *
 * APPROVED → COLLECTION_OTP_PENDING → COLLECTED → ACTIVE_LOAN (→ OVERDUE)
 *   → RETURN_REQUESTED → RETURN_VERIFICATION_PENDING → RETURNED → COMPLETED
 *
 * Side branches: CANCELLED (before pickup), DAMAGE_REPORTED, DISPUTED.
 */
export const LOAN_TRANSITIONS: TransitionTable<LoanStatus> = {
  APPROVED: {
    COLLECTION_OTP_PENDING: ["SYSTEM"],
    CANCELLED: ["BORROWER", "OWNER", "ADMIN", "SYSTEM"],
  },
  COLLECTION_OTP_PENDING: {
    COLLECTED: ["OWNER"],
    CANCELLED: ["BORROWER", "OWNER", "ADMIN", "SYSTEM"],
  },
  COLLECTED: {
    ACTIVE_LOAN: ["SYSTEM"],
  },
  ACTIVE_LOAN: {
    OVERDUE: ["SYSTEM"],
    RETURN_REQUESTED: ["BORROWER"],
    DISPUTED: ["OWNER", "ADMIN"],
  },
  OVERDUE: {
    RETURN_REQUESTED: ["BORROWER"],
    DISPUTED: ["OWNER", "ADMIN"],
  },
  RETURN_REQUESTED: {
    RETURN_VERIFICATION_PENDING: ["OWNER"],
    DAMAGE_REPORTED: ["OWNER"],
    DISPUTED: ["OWNER", "ADMIN"],
  },
  RETURN_VERIFICATION_PENDING: {
    RETURNED: ["OWNER"],
    DAMAGE_REPORTED: ["OWNER"],
    DISPUTED: ["OWNER", "ADMIN"],
  },
  RETURNED: {
    COMPLETED: ["SYSTEM"],
  },
  DAMAGE_REPORTED: {
    RETURN_VERIFICATION_PENDING: ["OWNER", "ADMIN"],
    DISPUTED: ["BORROWER", "OWNER", "ADMIN"],
  },
  DISPUTED: {
    RETURN_VERIFICATION_PENDING: ["OWNER", "ADMIN"],
    ACTIVE_LOAN: ["ADMIN"],
    COMPLETED: ["ADMIN"],
  },
  COMPLETED: {},
  CANCELLED: {},
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus, actor: LifecycleActor): boolean {
  return REQUEST_TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export function canTransitionLoan(from: LoanStatus, to: LoanStatus, actor: LifecycleActor): boolean {
  return LOAN_TRANSITIONS[from][to]?.includes(actor) ?? false;
}

export class TransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
    readonly actor: LifecycleActor,
  ) {
    super(`Transition ${from} → ${to} is not allowed for ${actor.toLowerCase()}`);
    this.name = "TransitionError";
  }
}

export function assertLoanTransition(from: LoanStatus, to: LoanStatus, actor: LifecycleActor): void {
  if (!canTransitionLoan(from, to, actor)) throw new TransitionError(from, to, actor);
}

export function assertRequestTransition(from: RequestStatus, to: RequestStatus, actor: LifecycleActor): void {
  if (!canTransitionRequest(from, to, actor)) throw new TransitionError(from, to, actor);
}

export const TERMINAL_LOAN_STATUSES: readonly LoanStatus[] = ["COMPLETED", "CANCELLED"];

/** Loans that hold the tool's calendar: the approved window cannot be double booked. */
export const BLOCKING_LOAN_STATUSES: readonly LoanStatus[] = [
  "APPROVED",
  "COLLECTION_OTP_PENDING",
  "COLLECTED",
  "ACTIVE_LOAN",
  "OVERDUE",
  "RETURN_REQUESTED",
  "RETURN_VERIFICATION_PENDING",
  "RETURNED",
  "DAMAGE_REPORTED",
  "DISPUTED",
];

/** The borrower physically holds the tool. */
export const IN_POSSESSION_STATUSES: readonly LoanStatus[] = ["COLLECTED", "ACTIVE_LOAN", "OVERDUE"];

/** The hand-back is in progress or contested. */
export const RETURNING_STATUSES: readonly LoanStatus[] = [
  "RETURN_REQUESTED",
  "RETURN_VERIFICATION_PENDING",
  "RETURNED",
  "DAMAGE_REPORTED",
  "DISPUTED",
];

/** Approved but not yet collected. */
export const RESERVED_STATUSES: readonly LoanStatus[] = ["APPROVED", "COLLECTION_OTP_PENDING"];

export function isTerminalLoanStatus(status: LoanStatus): boolean {
  return TERMINAL_LOAN_STATUSES.includes(status);
}

export interface ToolStatusInputs {
  removed: boolean;
  listed: boolean;
  ownerActive: boolean;
  /** Statuses of every non-terminal loan for the tool. */
  openLoanStatuses: readonly LoanStatus[];
  hasPendingRequests: boolean;
}

/**
 * The tool's public status is derived from its loans and requests rather than
 * set by clients. Possession and hand-back states take precedence over the
 * owner's listing toggle so an owner can unlist an item while it is lent out.
 */
export function deriveToolStatus(input: ToolStatusInputs): ToolStatus {
  if (input.removed) return "REMOVED";
  if (input.openLoanStatuses.some((s) => IN_POSSESSION_STATUSES.includes(s))) return "LENT";
  if (input.openLoanStatuses.some((s) => RETURNING_STATUSES.includes(s))) return "RETURN_PENDING";
  if (!input.listed || !input.ownerActive) return "UNAVAILABLE";
  if (input.openLoanStatuses.some((s) => RESERVED_STATUSES.includes(s))) return "RESERVED";
  if (input.hasPendingRequests) return "PENDING_REQUEST";
  return "AVAILABLE";
}

export function isDiscoverableStatus(status: ToolStatus): boolean {
  return status === "AVAILABLE" || status === "PENDING_REQUEST" || status === "RESERVED";
}

/** Coarse grouping used by the My Requests tabs. */
export type BorrowerTab =
  | "PENDING"
  | "APPROVED"
  | "DECLINED"
  | "ACTIVE"
  | "RETURN_PENDING"
  | "COMPLETED"
  | "CANCELLED";

export function borrowerTabFor(requestStatus: RequestStatus, loanStatus: LoanStatus | null): BorrowerTab {
  if (requestStatus === "PENDING") return "PENDING";
  if (requestStatus === "DECLINED") return "DECLINED";
  if (requestStatus === "CANCELLED" || requestStatus === "EXPIRED") return "CANCELLED";
  // APPROVED request: classify by the loan.
  if (!loanStatus) return "APPROVED";
  if (loanStatus === "APPROVED" || loanStatus === "COLLECTION_OTP_PENDING") return "APPROVED";
  if (IN_POSSESSION_STATUSES.includes(loanStatus)) return "ACTIVE";
  if (RETURNING_STATUSES.includes(loanStatus)) return "RETURN_PENDING";
  if (loanStatus === "COMPLETED") return "COMPLETED";
  return "CANCELLED";
}
