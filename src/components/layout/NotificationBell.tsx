"use client";

import clsx from "clsx";
import { useMutation, useQuery } from "convex/react";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { IconButton } from "@/components/common/Button";
import { useToast } from "@/components/common/Toast";
import { errorMessage } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { notificationHref } from "@/lib/notifications";
import styles from "./NotificationBell.module.scss";
import { Popover, type PopoverPlacement } from "./Popover";

export function NotificationBell({ placement = "below-end", variant = "icon" }: { placement?: PopoverPlacement; variant?: "icon" | "rail" }) {
  const [open, setOpen] = useState(false);
  const unread = useQuery(api.notifications.unreadCount, {}) ?? 0;
  const items = useQuery(api.notifications.list, open ? { limit: 8 } : "skip");
  const markRead = useMutation(api.notifications.markRead);
  const markAll = useMutation(api.notifications.markAllRead);
  const router = useRouter();
  const toast = useToast();

  return (
    <div className={styles.wrap}>
      {variant === "rail" ? (
        <button type="button" className={styles.railButton} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}>
          <span className={styles.railIcon}>
            <Bell aria-hidden />
            {unread > 0 && <span className={clsx(styles.dot, "num")}>{unread > 9 ? "9+" : unread}</span>}
          </span>
          <span className={styles.railLabel}>Alerts</span>
        </button>
      ) : (
        <IconButton label={unread ? `Notifications (${unread} unread)` : "Notifications"} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Bell />
          {unread > 0 && <span className={clsx(styles.dot, "num")}>{unread > 9 ? "9+" : unread}</span>}
        </IconButton>
      )}
      <Popover open={open} onClose={() => setOpen(false)} width={360} placement={placement}>
        <div className={styles.head}>
          <span>Notifications</span>
          {unread > 0 && (
            <button type="button" onClick={() => markAll().catch((e) => toast.error(errorMessage(e)))}>
              Mark all read
            </button>
          )}
        </div>
        <div className={styles.list}>
          {items === undefined ? (
            <p className={styles.empty}>Loading…</p>
          ) : items.length === 0 ? (
            <p className={styles.empty}>You&apos;re all caught up.</p>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                className={clsx(styles.item, !n.read && styles.unread)}
                onClick={() => {
                  setOpen(false);
                  if (!n.read) markRead({ notificationId: n.id }).catch(() => undefined);
                  router.push(notificationHref(n));
                }}
              >
                <span className={styles.title}>{n.title}</span>
                <span className={styles.body}>{n.body}</span>
                <span className={styles.time}>{relativeTime(n.createdAt)}</span>
              </button>
            ))
          )}
        </div>
        <Link href="/notifications" className={styles.all} onClick={() => setOpen(false)}>
          View all notifications
        </Link>
      </Popover>
    </div>
  );
}
