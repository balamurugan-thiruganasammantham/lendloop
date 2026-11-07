import { ConvexError } from "convex/values";

export interface ClientError {
  code: string;
  message: string;
  retryable: boolean;
  data: Record<string, unknown>;
}

const FALLBACKS: Record<string, string> = {
  UNAUTHENTICATED: "Your session has ended. Please sign in again.",
  PROFILE_MISSING: "We're still setting up your profile. Please try again in a moment.",
  ACCOUNT_SUSPENDED: "Your account is suspended.",
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: "That item no longer exists or you don't have access to it.",
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  CONFIG: "This feature isn't configured on the server yet.",
  NETWORK: "You appear to be offline. Check your connection and try again.",
  UNKNOWN: "Something went wrong on our side. Please try again.",
};

/**
 * Convert any thrown value into a message that is safe to show. Only
 * ConvexError payloads (which the backend writes for users) are surfaced
 * verbatim; unexpected errors never leak internal details.
 */
/** Payload of a ConvexError. Matched by shape too: errors re-thrown from actions aren't always `instanceof` the client's class. */
function convexErrorData(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ConvexError) && !(typeof error === "object" && error !== null && "data" in error)) return null;
  let data: unknown = (error as { data: unknown }).data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return typeof data === "object" && data !== null && typeof (data as { code?: unknown }).code === "string" ? (data as Record<string, unknown>) : null;
}

export function toClientError(error: unknown): ClientError {
  const data = convexErrorData(error);
  if (data) {
    const code = typeof data.code === "string" ? data.code : "UNKNOWN";
    const message = typeof data.message === "string" ? data.message : (FALLBACKS[code] ?? FALLBACKS.UNKNOWN!);
    return { code, message, retryable: code === "RATE_LIMITED", data };
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { code: "NETWORK", message: FALLBACKS.NETWORK!, retryable: true, data: {} };
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return { code: "NETWORK", message: FALLBACKS.NETWORK!, retryable: true, data: {} };
  }
  if (process.env.NODE_ENV !== "production") console.error(error);
  return { code: "UNKNOWN", message: FALLBACKS.UNKNOWN!, retryable: true, data: {} };
}

export function errorMessage(error: unknown): string {
  return toClientError(error).message;
}
