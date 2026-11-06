/**
 * Domain constants shared by the Convex backend and the Next.js frontend.
 * This module must stay free of runtime-specific imports.
 */

export const TOOL_CATEGORIES = [
  "POWER_TOOLS",
  "GARDEN_TOOLS",
  "KITCHEN_EQUIPMENT",
  "CAMPING_EQUIPMENT",
  "CLEANING_EQUIPMENT",
  "AUTOMOTIVE_TOOLS",
  "ELECTRONICS",
  "CONSTRUCTION_TOOLS",
  "SPORTS_EQUIPMENT",
  "OTHER",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  POWER_TOOLS: "Power Tools",
  GARDEN_TOOLS: "Garden Tools",
  KITCHEN_EQUIPMENT: "Kitchen Equipment",
  CAMPING_EQUIPMENT: "Camping Equipment",
  CLEANING_EQUIPMENT: "Cleaning Equipment",
  AUTOMOTIVE_TOOLS: "Automotive Tools",
  ELECTRONICS: "Electronics",
  CONSTRUCTION_TOOLS: "Construction Tools",
  SPORTS_EQUIPMENT: "Sports Equipment",
  OTHER: "Other",
};

export const TOOL_CONDITIONS = ["BRAND_NEW", "LIKE_NEW", "GOOD", "FAIR", "HEAVILY_USED"] as const;
export type ToolCondition = (typeof TOOL_CONDITIONS)[number];

export const CONDITION_LABELS: Record<ToolCondition, string> = {
  BRAND_NEW: "Brand new",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  HEAVILY_USED: "Heavily used",
};

export const TOOL_STATUSES = [
  "AVAILABLE",
  "PENDING_REQUEST",
  "RESERVED",
  "LENT",
  "RETURN_PENDING",
  "UNAVAILABLE",
  "REMOVED",
] as const;
export type ToolStatus = (typeof TOOL_STATUSES)[number];

/** Tool statuses that appear in discovery and can receive new borrow requests. */
export const DISCOVERABLE_TOOL_STATUSES: readonly ToolStatus[] = ["AVAILABLE", "PENDING_REQUEST", "RESERVED"];

export const REQUEST_STATUSES = ["PENDING", "APPROVED", "DECLINED", "CANCELLED", "EXPIRED"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const LOAN_STATUSES = [
  "APPROVED",
  "COLLECTION_OTP_PENDING",
  "COLLECTED",
  "ACTIVE_LOAN",
  "OVERDUE",
  "RETURN_REQUESTED",
  "RETURN_VERIFICATION_PENDING",
  "RETURNED",
  "COMPLETED",
  "CANCELLED",
  "DAMAGE_REPORTED",
  "DISPUTED",
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const USER_ROLES = ["USER", "ADMIN"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ACCOUNT_STATUSES = ["ACTIVE", "SUSPENDED"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const OTP_PURPOSES = ["COLLECTION", "RETURN"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const FEEDBACK_TAGS = [
  "RETURNED_GOOD_CONDITION",
  "COMMUNICATED_WELL",
  "RETURNED_ON_TIME",
  "EASY_TO_COORDINATE",
  "ITEM_AS_DESCRIBED",
  "ITEM_DAMAGED",
  "RETURNED_LATE",
  "POOR_COMMUNICATION",
] as const;
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];

export const FEEDBACK_TAG_LABELS: Record<FeedbackTag, string> = {
  RETURNED_GOOD_CONDITION: "Returned in good condition",
  COMMUNICATED_WELL: "Communicated well",
  RETURNED_ON_TIME: "Returned on time",
  EASY_TO_COORDINATE: "Easy to coordinate",
  ITEM_AS_DESCRIBED: "Item as described",
  ITEM_DAMAGED: "Item damaged",
  RETURNED_LATE: "Returned late",
  POOR_COMMUNICATION: "Poor communication",
};

/** Tags only meaningful when the owner reviews the borrower. */
export const OWNER_ONLY_TAGS: readonly FeedbackTag[] = [
  "RETURNED_GOOD_CONDITION",
  "RETURNED_ON_TIME",
  "ITEM_DAMAGED",
  "RETURNED_LATE",
];
/** Tags only meaningful when the borrower reviews the owner. */
export const BORROWER_ONLY_TAGS: readonly FeedbackTag[] = ["ITEM_AS_DESCRIBED"];

export const NOTIFICATION_TYPES = [
  "REQUEST_CREATED",
  "REQUEST_APPROVED",
  "REQUEST_DECLINED",
  "REQUEST_CANCELLED",
  "REQUEST_EXPIRED",
  "PICKUP_OTP_GENERATED",
  "PICKUP_CONFIRMED",
  "RETURN_REQUESTED",
  "RETURN_OTP_GENERATED",
  "ITEM_RETURNED",
  "DAMAGE_REPORTED",
  "DAMAGE_RESPONSE",
  "NOT_RETURNED_REPORTED",
  "FEEDBACK_RECEIVED",
  "LOAN_OVERDUE",
  "LOAN_CANCELLED",
  "ADMIN_ACTION",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const DAMAGE_REPORT_STATUSES = ["OPEN", "ACKNOWLEDGED", "CONTESTED", "UPHELD", "DISMISSED"] as const;
export type DamageReportStatus = (typeof DAMAGE_REPORT_STATUSES)[number];

export const DISPUTE_OUTCOMES = ["RETURNED", "NOT_RETURNED", "REOPEN"] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export const LIMITS = {
  toolNameMin: 3,
  toolNameMax: 80,
  descriptionMin: 10,
  descriptionMax: 2000,
  areaMax: 80,
  addressMax: 200,
  instructionsMax: 1000,
  termsMax: 500,
  maxImages: 6,
  maxImageBytes: 5 * 1024 * 1024,
  maxLoanDaysCeiling: 30,
  messageMax: 500,
  reasonMax: 500,
  feedbackCommentMax: 1000,
  bioMax: 280,
  nameMax: 60,
  returnPhotosMax: 4,
  evidenceMax: 6,
  damageDescriptionMin: 10,
  damageDescriptionMax: 2000,
} as const;

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const OTP_CONFIG = {
  digits: 6,
  maxAttempts: 5,
  /** On-demand codes requested by the borrower at the meetup. */
  onDemandTtlMs: 15 * 60 * 1000,
  /** Return codes generated when the owner confirms the hand-back. */
  returnTtlMs: 30 * 60 * 1000,
  /** Collection codes issued automatically on approval stay valid through the pickup window. */
  collectionGraceMs: 24 * 60 * 60 * 1000,
  collectionMaxTtlMs: 7 * 24 * 60 * 60 * 1000,
  minTtlMs: 15 * 60 * 1000,
} as const;

export const TIME = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
} as const;

/** Return considered late when the borrower starts the return more than this after the agreed time. */
export const LATE_RETURN_GRACE_MS = 60 * 60 * 1000;
/** Approved loans whose pickup window passed by this much without collection are cancelled. */
export const PICKUP_WINDOW_MS = 48 * 60 * 60 * 1000;

export const DEFAULT_DISCOVERY_RADIUS_KM = 10;
export const MAX_DISCOVERY_RADIUS_KM = 50;

/** Sample neighbourhood used by seed data (Indiranagar, Bengaluru). */
export const SEED_NEIGHBORHOOD = {
  label: "Indiranagar, Bengaluru",
  lat: 12.9719,
  lng: 77.6412,
} as const;
