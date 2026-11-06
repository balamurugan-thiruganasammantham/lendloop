import type { LoanStatus, RequestStatus, ToolStatus } from "@convex/lib/constants";

export type Tone = "neutral" | "accent" | "success" | "warn" | "danger" | "info" | "ink";

export const TOOL_STATUS_META: Record<ToolStatus, { label: string; tone: Tone }> = {
  AVAILABLE: { label: "Available", tone: "success" },
  PENDING_REQUEST: { label: "Requested", tone: "info" },
  RESERVED: { label: "Reserved", tone: "warn" },
  LENT: { label: "Lent out", tone: "ink" },
  RETURN_PENDING: { label: "Return pending", tone: "warn" },
  UNAVAILABLE: { label: "Paused", tone: "neutral" },
  REMOVED: { label: "Removed", tone: "danger" },
};

export const REQUEST_STATUS_META: Record<RequestStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  DECLINED: { label: "Declined", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

export const LOAN_STATUS_META: Record<LoanStatus, { label: string; tone: Tone; hint: string }> = {
  APPROVED: { label: "Approved", tone: "success", hint: "Waiting for the pickup code" },
  COLLECTION_OTP_PENDING: { label: "Ready for pickup", tone: "accent", hint: "Meet, share the code, collect" },
  COLLECTED: { label: "Collected", tone: "accent", hint: "Hand-over confirmed" },
  ACTIVE_LOAN: { label: "Active", tone: "accent", hint: "Tool is with the borrower" },
  OVERDUE: { label: "Overdue", tone: "danger", hint: "Past the agreed return time" },
  RETURN_REQUESTED: { label: "Return requested", tone: "warn", hint: "Borrower is ready to return" },
  RETURN_VERIFICATION_PENDING: { label: "Verifying return", tone: "warn", hint: "Waiting for the return code" },
  RETURNED: { label: "Returned", tone: "success", hint: "Return confirmed" },
  COMPLETED: { label: "Completed", tone: "success", hint: "Loan closed" },
  CANCELLED: { label: "Cancelled", tone: "neutral", hint: "Cancelled before pickup" },
  DAMAGE_REPORTED: { label: "Damage reported", tone: "danger", hint: "Awaiting borrower response" },
  DISPUTED: { label: "Disputed", tone: "danger", hint: "Under admin review" },
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "loan.created": "Loan created",
  "loan.status_changed": "Status changed",
  "otp.issued": "Hand-over code issued",
  "otp.verified": "Code verified",
  "otp.failed_attempt": "Incorrect code entered",
  "otp.locked": "Code locked after failed attempts",
  "loan.return_arrangement_updated": "Return arrangement updated",
};
