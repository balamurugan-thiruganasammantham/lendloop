import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  vAccountStatus,
  vActorType,
  vAuditMeta,
  vAutomationPayload,
  vAutomationStatus,
  vDamageReportStatus,
  vDeliveryResult,
  vDisputeOutcome,
  vFeedbackDirection,
  vFeedbackStatus,
  vFeedbackTag,
  vLoanStatus,
  vNotificationType,
  vOtpPurpose,
  vOtpStatus,
  vReminderStatus,
  vReportStatus,
  vReportTarget,
  vRequestStatus,
  vStats,
  vToolCategory,
  vToolCondition,
  vToolStatus,
  vUserRole,
} from "./validators";

export default defineSchema({
  /**
   * Application user, synchronised from the Clerk identity on sign-in.
   * `role` is never writable by clients; see admin.setRoleByEmail (internal).
   */
  users: defineTable({
    tokenIdentifier: v.string(),
    clerkUserId: v.string(),
    email: v.string(),
    name: v.string(),
    imageUrl: v.optional(v.string()),
    phoneNumber: v.optional(v.string()),
    phoneVerified: v.boolean(),
    bio: v.optional(v.string()),
    /** Neighbourhood label, e.g. "Indiranagar". */
    areaLabel: v.optional(v.string()),
    /** Coarsened (≈1 km) coordinates; never the user's exact location. */
    approxLat: v.optional(v.number()),
    approxLng: v.optional(v.number()),
    /** Whether the user lets the app use device location on the map. */
    locationSharing: v.boolean(),
    role: vUserRole,
    status: vAccountStatus,
    suspendedReason: v.optional(v.string()),
    trustedLender: v.boolean(),
    onboardedAt: v.optional(v.number()),
    stats: vStats,
    isSeed: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"])
    .index("by_role", ["role"])
    .index("by_status", ["status"])
    .index("by_seed", ["isSeed"]),

  /** Public listing. Contains only approximate coordinates. */
  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category: vToolCategory,
    description: v.string(),
    condition: vToolCondition,
    imageIds: v.array(v.id("_storage")),
    /** Attribution for licensed demo photos (seed data only). */
    imageCredits: v.optional(v.array(v.object({ creator: v.string(), license: v.string(), sourceUrl: v.string() }))),
    pickupArea: v.string(),
    approxLat: v.number(),
    approxLng: v.number(),
    instructions: v.optional(v.string()),
    lendingTerms: v.optional(v.string()),
    depositAmount: v.optional(v.number()),
    maxLoanDays: v.number(),
    availableFrom: v.optional(v.number()),
    availableUntil: v.optional(v.number()),
    /** Owner's listing toggle. Status itself is derived by the backend. */
    isListed: v.boolean(),
    status: vToolStatus,
    discoverable: v.boolean(),
    searchText: v.string(),
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
    removedReason: v.optional(v.string()),
    isSeed: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_status", ["status"])
    .index("by_discoverable_lat", ["discoverable", "approxLat"])
    .index("by_discoverable_created", ["discoverable", "createdAt"])
    .index("by_seed", ["isSeed"])
    .searchIndex("search_text", { searchField: "searchText", filterFields: ["discoverable", "category"] }),

  /**
   * Exact pickup location. Kept in a separate table so that no tool query can
   * return it by accident; only loans.get reveals it to an approved borrower.
   */
  toolPickupLocations: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    lat: v.number(),
    lng: v.number(),
    address: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_tool", ["toolId"]),

  borrowRequests: defineTable({
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    pickupAt: v.number(),
    returnBy: v.number(),
    message: v.optional(v.string()),
    status: vRequestStatus,
    declineReason: v.optional(v.string()),
    loanId: v.optional(v.id("loans")),
    decidedAt: v.optional(v.number()),
    isSeed: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_borrower_status", ["borrowerId", "status"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_tool_status", ["toolId", "status"])
    .index("by_borrower_tool_status", ["borrowerId", "toolId", "status"])
    .index("by_status_pickup", ["status", "pickupAt"])
    .index("by_seed", ["isSeed"]),

  loans: defineTable({
    requestId: v.id("borrowRequests"),
    toolId: v.id("tools"),
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    status: vLoanStatus,
    pickupAt: v.number(),
    returnBy: v.number(),
    /** Snapshot so history survives listing edits or removal. */
    toolName: v.string(),
    toolCategory: vToolCategory,
    returnArrangement: v.optional(v.string()),
    collectedAt: v.optional(v.number()),
    returnRequestedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()),
    wasOverdue: v.boolean(),
    lateReturn: v.optional(v.boolean()),
    disputeReason: v.optional(v.string()),
    disputeOutcome: v.optional(vDisputeOutcome),
    disputeResolutionNote: v.optional(v.string()),
    isSeed: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_borrower_status", ["borrowerId", "status"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_tool_status", ["toolId", "status"])
    .index("by_status_returnBy", ["status", "returnBy"])
    .index("by_status_pickup", ["status", "pickupAt"])
    .index("by_status", ["status"])
    .index("by_request", ["requestId"])
    .index("by_seed", ["isSeed"]),

  /** Hashed one-time codes for collection and return hand-overs. */
  otpVerifications: defineTable({
    loanId: v.id("loans"),
    purpose: vOtpPurpose,
    recipientId: v.id("users"),
    verifierId: v.id("users"),
    codeHash: v.string(),
    status: vOtpStatus,
    attempts: v.number(),
    maxAttempts: v.number(),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_loan_purpose_status", ["loanId", "purpose", "status"])
    .index("by_loan", ["loanId"]),

  returnSubmissions: defineTable({
    loanId: v.id("loans"),
    borrowerId: v.id("users"),
    photoIds: v.array(v.id("_storage")),
    notes: v.optional(v.string()),
    submittedAt: v.number(),
  }).index("by_loan", ["loanId"]),

  damageReports: defineTable({
    loanId: v.id("loans"),
    toolId: v.id("tools"),
    reporterId: v.id("users"),
    subjectId: v.id("users"),
    description: v.string(),
    evidenceIds: v.array(v.id("_storage")),
    status: vDamageReportStatus,
    borrowerResponse: v.optional(v.string()),
    resolutionNote: v.optional(v.string()),
    resolvedBy: v.optional(v.id("users")),
    isSeed: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_loan", ["loanId"])
    .index("by_subject", ["subjectId"])
    .index("by_status", ["status"]),

  feedback: defineTable({
    loanId: v.id("loans"),
    authorId: v.id("users"),
    subjectId: v.id("users"),
    direction: vFeedbackDirection,
    rating: v.number(),
    comment: v.optional(v.string()),
    tags: v.array(vFeedbackTag),
    status: vFeedbackStatus,
    isSeed: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_loan_author", ["loanId", "authorId"])
    .index("by_subject", ["subjectId"])
    .index("by_status", ["status"]),

  userReports: defineTable({
    reporterId: v.id("users"),
    targetType: vReportTarget,
    targetId: v.string(),
    reason: v.string(),
    status: vReportStatus,
    reviewedBy: v.optional(v.id("users")),
    reviewNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_reporter_target", ["reporterId", "targetType", "targetId"]),

  notifications: defineTable({
    userId: v.id("users"),
    type: vNotificationType,
    title: v.string(),
    body: v.string(),
    loanId: v.optional(v.id("loans")),
    toolId: v.optional(v.id("tools")),
    requestId: v.optional(v.id("borrowRequests")),
    read: v.boolean(),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"]),

  auditLogs: defineTable({
    actorId: v.optional(v.id("users")),
    actorType: vActorType,
    action: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    fromStatus: v.optional(v.string()),
    toStatus: v.optional(v.string()),
    meta: v.optional(vAuditMeta),
    createdAt: v.number(),
  })
    .index("by_resource", ["resourceType", "resourceId"])
    .index("by_actor", ["actorId"])
    .index("by_action", ["action"]),

  /** Outbox of events delivered to n8n (Convex → n8n). */
  automationEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    recipientId: v.id("users"),
    loanId: v.optional(v.id("loans")),
    requestId: v.optional(v.id("borrowRequests")),
    toolId: v.optional(v.id("tools")),
    payload: vAutomationPayload,
    status: vAutomationStatus,
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    deliveredAt: v.optional(v.number()),
    /** Set by n8n when it claims the event for email delivery (dedup). */
    claimedAt: v.optional(v.number()),
    deliveryResult: v.optional(vDeliveryResult),
    deliveryReportedAt: v.optional(v.number()),
    deliveryError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_status", ["status"])
    .index("by_loan", ["loanId"])
    .index("by_request", ["requestId"]),

  /** Idempotency ledger for overdue reminders: one per loan per period. */
  automationReminders: defineTable({
    loanId: v.id("loans"),
    period: v.string(),
    reminderKey: v.string(),
    status: vReminderStatus,
    attempts: v.number(),
    claimedAt: v.number(),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    executionId: v.optional(v.string()),
  })
    .index("by_key", ["reminderKey"])
    .index("by_loan", ["loanId"]),

  /** Inbound signed requests from n8n (replay protection + receipt log). */
  webhookEvents: defineTable({
    source: v.string(),
    nonce: v.string(),
    route: v.string(),
    relatedEventId: v.optional(v.string()),
    outcome: v.string(),
    receivedAt: v.number(),
  })
    .index("by_nonce", ["nonce"])
    .index("by_received", ["receivedAt"]),

  /** Failures reported by the n8n error workflow, plus workflow run summaries. */
  automationFailures: defineTable({
    workflowName: v.string(),
    executionId: v.optional(v.string()),
    failedNode: v.optional(v.string()),
    errorMessage: v.string(),
    relatedEventId: v.optional(v.string()),
    occurredAt: v.number(),
    status: v.union(v.literal("OPEN"), v.literal("RESOLVED")),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"]),

  automationRuns: defineTable({
    workflowName: v.string(),
    executionId: v.optional(v.string()),
    processed: v.number(),
    sent: v.number(),
    skipped: v.number(),
    failed: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.number(),
  }).index("by_workflow", ["workflowName"]),

  /**
   * Ownership ledger for uploaded files. Storage IDs appear in public URLs, so
   * a file may only be attached by the user who uploaded it.
   */
  uploads: defineTable({
    storageId: v.id("_storage"),
    ownerId: v.id("users"),
    contentType: v.string(),
    size: v.number(),
    attached: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_owner", ["ownerId"])
    .index("by_attached_created", ["attached", "createdAt"]),

  /** Fixed-window rate limiting counters. */
  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Development-only mailbox used when EMAIL_DELIVERY_MODE=mock. Visible only
   * to the recipient and purged after 24 hours. Never enabled in production.
   */
  devMailbox: defineTable({
    userId: v.id("users"),
    to: v.string(),
    subject: v.string(),
    text: v.string(),
    kind: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),
});
