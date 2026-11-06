import { ConvexError } from "convex/values";

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "PROFILE_MISSING"
  | "ACCOUNT_SUSPENDED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_STATE"
  | "CONFLICT"
  | "DUPLICATE"
  | "UNAVAILABLE"
  | "RATE_LIMITED"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_LOCKED"
  | "OTP_MISSING"
  | "CONFIG";

export interface AppErrorData {
  code: AppErrorCode;
  message: string;
  [key: string]: string | number | boolean | null;
}

/**
 * Errors thrown with ConvexError are delivered to the client with their data.
 * Messages must be safe to show to end users; never include secrets, OTPs or
 * internal identifiers. Unexpected errors (plain Error) are redacted by Convex.
 */
export function appError(
  code: AppErrorCode,
  message: string,
  extra: Record<string, string | number | boolean | null> = {},
): ConvexError<AppErrorData> {
  return new ConvexError<AppErrorData>({ ...extra, code, message });
}

export function invalid(message: string, extra?: Record<string, string | number | boolean | null>) {
  return appError("INVALID_INPUT", message, extra);
}

export function notFound(what = "Resource") {
  return appError("NOT_FOUND", `${what} not found.`);
}

export function forbidden(message = "You do not have permission to do that.") {
  return appError("FORBIDDEN", message);
}
