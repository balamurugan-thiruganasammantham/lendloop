"use client";

import clsx from "clsx";
import { useQuery } from "convex/react";
import { ArrowLeftRight, Compass, History, Inbox, LayoutGrid, Menu, Plus, Shield, Wrench, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "@convex/_generated/api";
import { Logo } from "@/components/brand/Logo";
import { useViewer } from "@/features/authentication/ViewerContext";
import styles from "./AppShell.module.scss";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";

interface NavItem {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  badge?: number;
}

function useNavItems(): NavItem[] {
  const viewer = useViewer();
  const incoming = useQuery(api.requests.incomingCount, {}) ?? 0;
  const active = useQuery(api.loans.activeCount, {}) ?? 0;
  const items: NavItem[] = [
    { href: "/explore", label: "Explore", short: "Map", icon: Compass },
    { href: "/listings", label: "My Listings", short: "Listings", icon: Wrench },
    { href: "/requests", label: "My Requests", short: "Requests", icon: ArrowLeftRight },
    { href: "/incoming", label: "Incoming Requests", short: "Incoming", icon: Inbox, badge: incoming },
    { href: "/loans", label: "Active Loans", short: "Loans", icon: LayoutGrid, badge: active },
    { href: "/history", label: "History", short: "History", icon: History },
  ];
  if (viewer.role === "ADMIN") items.push({ href: "/admin", label: "Admin", short: "Admin", icon: Shield });
  return items;
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const items = useNavItems();
  const explore = pathname === "/explore";
  const mobileTabs: NavItem[] = [
    items[0]!,
    items[1]!,
    { ...items[2]!, badge: undefined },
    items[4]!,
    { href: "/more", label: "More", short: "More", icon: Menu, badge: items[3]!.badge },
  ];

  return (
    <div className={clsx(styles.shell, explore && styles.exploreShell)}>
      <nav className={styles.rail} aria-label="Main">
        <div className={styles.railTop}>
          <Logo compact href="/explore" className={styles.logo} />
          <ul>
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link href={item.href} className={clsx(styles.railItem, active && styles.railActive)} aria-current={active ? "page" : undefined} title={item.label}>
                    <span className={styles.railIcon}>
                      <item.icon aria-hidden />
                      {item.badge ? <span className={clsx(styles.badge, "num")}>{item.badge > 9 ? "9+" : item.badge}</span> : null}
                    </span>
                    <span className={styles.railLabel}>{item.short}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <div className={styles.railBottom}>
          <Link href="/listings/new" className={styles.railItem} title="List a tool">
            <span className={styles.railIcon}>
              <Plus aria-hidden />
            </span>
            <span className={styles.railLabel}>Lend</span>
          </Link>
          <NotificationBell variant="rail" placement="right-end" />
          <UserMenu variant="rail" placement="right-end" />
        </div>
      </nav>

      {!explore && (
        <header className={styles.mobileTop}>
          <Logo href="/explore" />
          <div className={styles.mobileActions}>
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
      )}

      <main className={clsx(styles.main, explore && styles.fullBleed)} id="main">
        {children}
      </main>

      <nav className={styles.tabbar} aria-label="Main">
        {mobileTabs.map((item) => {
          const active =
            item.href === "/more"
              ? ["/more", "/incoming", "/history", "/profile", "/notifications", "/admin", "/dev"].some((p) => isActive(pathname, p))
              : isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} className={clsx(styles.tab, active && styles.tabActive)} aria-current={active ? "page" : undefined}>
              <span className={styles.tabIcon}>
                <item.icon aria-hidden />
                {item.badge ? <span className={clsx(styles.badge, "num")}>{item.badge > 9 ? "9+" : item.badge}</span> : null}
              </span>
              <span>{item.short}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function PageContainer({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div className={clsx(styles.container, narrow && styles.narrow)}>{children}</div>;
}
