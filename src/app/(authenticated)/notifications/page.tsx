"use client";

import clsx from "clsx";
import { useMutation, useQuery } from "convex/react";
import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Button } from "@/components/common/Button";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingState } from "@/components/common/States";
import { Tabs } from "@/components/common/Tabs";
import { useToast } from "@/components/common/Toast";
import { PageContainer } from "@/components/layout/AppShell";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, relativeTime } from "@/lib/format";
import { notificationHref } from "@/lib/notifications";
import styles from "./notifications.module.scss";

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const items = useQuery(api.notifications.list, { limit: 100, unreadOnly });
  const unread = useQuery(api.notifications.unreadCount, {}) ?? 0;
  const markRead = useMutation(api.notifications.markRead);
  const markAll = useMutation(api.notifications.markAllRead);
  const router = useRouter();
  const toast = useToast();
  return (
    <PageContainer narrow>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        actions={
          unread > 0 && (
            <Button icon={<CheckCheck />} onClick={() => markAll().catch((e) => toast.error(errorMessage(e)))}>
              Mark all read
            </Button>
          )
        }
      />
      <Tabs
        label="Filter"
        value={unreadOnly ? "UNREAD" : "ALL"}
        onChange={(k) => setUnreadOnly(k === "UNREAD")}
        items={[
          { key: "ALL", label: "All" },
          { key: "UNREAD", label: "Unread", count: unread },
        ]}
      />
      {items === undefined ? (
        <LoadingState rows={5} />
      ) : items.length === 0 ? (
        <EmptyState icon={<Bell />} title={unreadOnly ? "No unread notifications" : "No notifications yet"} />
      ) : (
        <ul className={styles.list}>
          {items.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={clsx(styles.item, !n.read && styles.unread)}
                onClick={() => {
                  if (!n.read) markRead({ notificationId: n.id }).catch(() => undefined);
                  router.push(notificationHref(n));
                }}
              >
                <span className={styles.title}>{n.title}</span>
                <span className={styles.body}>{n.body}</span>
                <span className={styles.time} title={formatDateTime(n.createdAt)}>
                  {relativeTime(n.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
