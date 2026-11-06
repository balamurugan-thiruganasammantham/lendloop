import clsx from "clsx";
import type { ReactNode } from "react";
import type { LoanStatus, RequestStatus, ToolStatus } from "@convex/lib/constants";
import { LOAN_STATUS_META, REQUEST_STATUS_META, TOOL_STATUS_META, type Tone } from "@/lib/status";
import styles from "./Badge.module.scss";

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={clsx(styles.badge, styles[tone], className)}>
      {dot && <span className={styles.dot} aria-hidden />}
      {children}
    </span>
  );
}

export function ToolStatusBadge({ status }: { status: ToolStatus }) {
  const meta = TOOL_STATUS_META[status];
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  const meta = REQUEST_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function LoanStatusBadge({ status }: { status: LoanStatus }) {
  const meta = LOAN_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

/** Marks development seed data so it's never mistaken for real activity. */
export function SampleTag() {
  return (
    <span className={styles.sample} title="Development seed data — not a real user or listing">
      Sample
    </span>
  );
}
