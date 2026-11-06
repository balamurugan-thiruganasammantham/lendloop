"use client";

import { useQuery } from "convex/react";
import { Bell, ChevronRight, History, Inbox, Mail, Shield, User } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { PageHeader } from "@/components/common/PageHeader";
import { PageContainer } from "@/components/layout/AppShell";
import { useViewer } from "@/features/authentication/ViewerContext";
import styles from "./more.module.scss";

/** Mobile overflow navigation (the tab bar shows the four most used sections). */
export default function MorePage() {
  const viewer = useViewer();
  const incoming = useQuery(api.requests.incomingCount, {}) ?? 0;
  const unread = useQuery(api.notifications.unreadCount, {}) ?? 0;
  const mailbox = useQuery(api.devMailbox.mine, {});
  const items = [
    { href: "/incoming", label: "Incoming requests", icon: Inbox, badge: incoming },
    { href: "/notifications", label: "Notifications", icon: Bell, badge: unread },
    { href: "/history", label: "History", icon: History },
    { href: "/profile", label: "Profile", icon: User },
    ...(viewer.role === "ADMIN" ? [{ href: "/admin", label: "Admin", icon: Shield }] : []),
    ...(mailbox?.enabled ? [{ href: "/dev/mailbox", label: "Dev mailbox", icon: Mail }] : []),
  ];
  return (
    <PageContainer narrow>
      <PageHeader title="More" />
      <ul className={styles.list}>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href}>
              <i.icon aria-hidden />
              <span>{i.label}</span>
              {"badge" in i && i.badge ? <span className={`${styles.badge} num`}>{i.badge}</span> : null}
              <ChevronRight aria-hidden className={styles.chev} />
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
