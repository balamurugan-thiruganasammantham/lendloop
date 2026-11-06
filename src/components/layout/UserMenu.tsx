"use client";

import { useClerk } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { LogOut, Mail, Shield, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { Avatar } from "@/components/common/Avatar";
import { useViewer } from "@/features/authentication/ViewerContext";
import { Popover, type PopoverPlacement } from "./Popover";
import styles from "./UserMenu.module.scss";

export function UserMenu({ placement = "below-end", variant = "icon" }: { placement?: PopoverPlacement; variant?: "icon" | "rail" }) {
  const viewer = useViewer();
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const mailbox = useQuery(api.devMailbox.mine, open ? {} : "skip");
  return (
    <div className={styles.wrap}>
      <button type="button" className={variant === "rail" ? styles.railTrigger : styles.trigger} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu">
        <Avatar name={viewer.name} src={viewer.imageUrl} size={variant === "rail" ? 34 : 30} />
        {variant === "rail" && <span className={styles.railLabel}>You</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} width={240} placement={placement}>
        <div className={styles.head}>
          <p className={styles.name}>{viewer.name}</p>
          <p className={styles.email}>{viewer.email}</p>
        </div>
        <nav className={styles.items} onClick={() => setOpen(false)}>
          <Link href="/profile">
            <User /> Profile
          </Link>
          {viewer.role === "ADMIN" && (
            <Link href="/admin">
              <Shield /> Admin
            </Link>
          )}
          {mailbox?.enabled && (
            <Link href="/dev/mailbox">
              <Mail /> Dev mailbox
            </Link>
          )}
          <button type="button" onClick={() => void signOut({ redirectUrl: "/" })}>
            <LogOut /> Sign out
          </button>
        </nav>
      </Popover>
    </div>
  );
}
