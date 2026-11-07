"use client";

import clsx from "clsx";
import { useQuery } from "convex/react";
import { BellRing, Clock3 } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { relativeTime } from "@/lib/format";
import styles from "./LoanDetail.module.scss";

const EVENT_LABELS: Record<string, string> = {
  "borrow_request.created": "new request",
  "borrow_request.approved": "request approved",
  "borrow_request.declined": "request declined",
  "borrow_request.cancelled": "request cancelled",
  "borrow_request.expired": "request expired",
  "loan.collected": "pickup confirmed",
  "loan.return_requested": "return requested",
  "loan.returned": "item returned",
  "loan.damage_reported": "damage reported",
  "loan.not_returned_reported": "not-returned report",
  "loan.cancelled": "loan cancelled",
  "admin.action": "admin action",
};

type Tone = "ok" | "muted" | "warn" | "bad";

function deliveryLabel(status: string, result: string | null, attempts: number): { text: string; tone: Tone } {
  if (status === "DELIVERED") {
    if (result === "SENT") return { text: "Email sent", tone: "ok" };
    if (result === "MOCKED") return { text: "Logged (mock email)", tone: "muted" };
    if (result === "FAILED") return { text: "Email failed", tone: "bad" };
    if (result === "SKIPPED") return { text: "Not emailed", tone: "muted" };
    return { text: "Delivered to n8n", tone: "ok" };
  }
  if (status === "PENDING") return attempts > 0 ? { text: `Retrying (attempt ${attempts + 1})`, tone: "warn" } : { text: "Queued", tone: "muted" };
  if (status === "FAILED") return { text: `Retrying after ${attempts} failed attempt${attempts === 1 ? "" : "s"}`, tone: "warn" };
  if (status === "DEAD") return { text: `Failed after ${attempts} attempts`, tone: "bad" };
  if (status === "SKIPPED") return { text: "Automation not configured", tone: "muted" };
  return { text: status.toLowerCase(), tone: "muted" };
}

function reminderLabel(status: string): { text: string; tone: Tone } {
  if (status === "SENT") return { text: "Email sent", tone: "ok" };
  if (status === "MOCKED") return { text: "Logged (mock email)", tone: "muted" };
  if (status === "FAILED") return { text: "Failed", tone: "bad" };
  return { text: "Sending…", tone: "warn" };
}

/**
 * Bonus: recent automation for this loan — n8n notification deliveries and overdue reminders,
 * e.g. "Lender notified · request approved · Email sent · 2 min ago".
 */
export function AutomationActivity({ loanId, role, counterpartName }: { loanId: Id<"loans">; role: "OWNER" | "BORROWER" | "ADMIN"; counterpartName: string }) {
  const items = useQuery(api.loans.automationActivity, { loanId });
  const [now] = useState(() => Date.now());
  if (!items) return null;

  const who = (recipient: "OWNER" | "BORROWER" | "OTHER") => {
    if (recipient === "OTHER") return "Admin";
    if (recipient === role) return "You were";
    if (role === "ADMIN") return recipient === "OWNER" ? "Lender" : "Borrower";
    return counterpartName;
  };

  return (
    <section className={styles.card} aria-labelledby="automation-heading">
      <header className={styles.cardHead}>
        <h2 id="automation-heading">Automation</h2>
      </header>
      {items.length === 0 ? (
        <p className={styles.autoEmpty}>No automated notifications or reminders for this loan yet.</p>
      ) : (
        <ul className={styles.autoList}>
          {items.map((item) => {
            const d = item.kind === "notification" ? deliveryLabel(item.status, item.result, item.attempts) : reminderLabel(item.status);
            const subject =
              item.kind === "notification"
                ? `${who(item.recipient)}${who(item.recipient) === "You were" ? "" : " was"} notified · ${EVENT_LABELS[item.eventType] ?? item.eventType}`
                : `Overdue reminder to ${role === "BORROWER" ? "you" : role === "OWNER" ? counterpartName : "the borrower"}`;
            return (
              <li key={item.id}>
                <span className={styles.autoIcon} aria-hidden>
                  {item.kind === "notification" ? <BellRing /> : <Clock3 />}
                </span>
                <div>
                  <p className={styles.tlTitle}>{subject}</p>
                  <p className={styles.tlMeta}>
                    <span className={clsx(styles.autoChip, styles[`auto_${d.tone}`])}>{d.text}</span> · {relativeTime(item.at, now)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
