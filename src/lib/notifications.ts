import type { NotificationType } from "@convex/lib/constants";

export function notificationHref(n: { type: NotificationType; loanId: string | null; requestId: string | null }): string {
  if (n.loanId) return `/loans/${n.loanId}`;
  if (n.type === "REQUEST_CREATED" || n.type === "REQUEST_CANCELLED") return "/incoming";
  if (n.requestId) return "/requests";
  if (n.type === "ADMIN_ACTION") return "/profile";
  return "/notifications";
}
