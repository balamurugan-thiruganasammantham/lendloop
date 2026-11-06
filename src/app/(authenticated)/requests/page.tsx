"use client";

import { useMutation, useQuery } from "convex/react";
import { ArrowLeftRight, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { BorrowerTab } from "@convex/lib/stateMachine";
import { Avatar } from "@/components/common/Avatar";
import { LoanStatusBadge, RequestStatusBadge, SampleTag } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingState } from "@/components/common/States";
import { Tabs } from "@/components/common/Tabs";
import { useToast } from "@/components/common/Toast";
import { ToolThumb } from "@/components/common/ToolThumb";
import { PageContainer } from "@/components/layout/AppShell";
import { formatDateTime, formatRange, relativeTime } from "@/lib/format";
import styles from "@/styles/pages/lists.module.scss";

const TABS: { key: BorrowerTab; label: string }[] = [
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "ACTIVE", label: "Active" },
  { key: "RETURN_PENDING", label: "Return pending" },
  { key: "COMPLETED", label: "Completed" },
  { key: "DECLINED", label: "Declined" },
  { key: "CANCELLED", label: "Cancelled" },
];

const EMPTY: Record<BorrowerTab, string> = {
  PENDING: "No requests waiting for an answer.",
  APPROVED: "No approved requests awaiting pickup.",
  ACTIVE: "You're not borrowing anything right now.",
  RETURN_PENDING: "No returns in progress.",
  COMPLETED: "No completed loans yet.",
  DECLINED: "No declined requests.",
  CANCELLED: "No cancelled or expired requests.",
};

function MyRequests() {
  const rows = useQuery(api.requests.mine, {});
  const cancel = useMutation(api.requests.cancel);
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key ?? "PENDING") as BorrowerTab;
  const [withdrawing, setWithdrawing] = useState<Id<"borrowRequests"> | null>(null);

  const counts = useMemo(() => {
    const c = {} as Record<BorrowerTab, number>;
    for (const r of rows ?? []) c[r.tab] = (c[r.tab] ?? 0) + 1;
    return c;
  }, [rows]);
  const visible = (rows ?? []).filter((r) => r.tab === tab);

  return (
    <PageContainer>
      <PageHeader eyebrow="Borrowing" title="My Requests" description="Everything you've asked to borrow, from request to return. Updates live." />
      <div className={styles.tabs}>
        <Tabs
          label="Request status"
          items={TABS.map((t) => ({ ...t, count: counts[t.key] }))}
          value={tab}
          onChange={(k) => router.replace(`/requests?tab=${k}`, { scroll: false })}
        />
      </div>
      {rows === undefined ? (
        <LoadingState rows={4} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight />}
          title={EMPTY[tab]}
          action={
            <Link href="/explore" className={styles.secondaryLink}>
              Find tools nearby
            </Link>
          }
        />
      ) : (
        <ul className={styles.list}>
          {visible.map((r) => (
            <li key={r.id} className={styles.row}>
              <ToolThumb src={r.tool.imageUrl} category={r.tool.category} size={64} />
              <div className={styles.main}>
                <div className={styles.titleLine}>
                  <h2 className={styles.title}>{r.tool.name}</h2>
                  {r.loan ? <LoanStatusBadge status={r.loan.status} /> : <RequestStatusBadge status={r.status} />}
                  {r.tool.isSeed && <SampleTag />}
                </div>
                {r.owner && (
                  <p className={styles.meta}>
                    <Avatar name={r.owner.name} src={r.owner.imageUrl} size={16} /> from <span className={styles.strong}>{r.owner.name}</span>
                  </p>
                )}
                <p className={styles.meta}>
                  {formatRange(r.pickupAt, r.returnBy)} · pickup {formatDateTime(r.pickupAt)}
                </p>
                {r.status === "DECLINED" && (
                  <p className={styles.note}>{r.declineReason ? `Owner's note: “${r.declineReason}”` : "The owner declined without a note."}</p>
                )}
                {r.status === "EXPIRED" && <p className={styles.note}>Expired — the pickup time passed before the owner responded.</p>}
              </div>
              <div className={styles.right}>
                <span className={styles.time}>Updated {relativeTime(r.updatedAt)}</span>
                {r.status === "PENDING" && (
                  <Button size="sm" variant="ghost" onClick={() => setWithdrawing(r.id)}>
                    Withdraw
                  </Button>
                )}
                {r.loan && (
                  <Link href={`/loans/${r.loan.id}`} className={styles.secondaryLink}>
                    {tab === "APPROVED"
                      ? "Pickup details"
                      : tab === "ACTIVE"
                        ? "Return item"
                        : tab === "COMPLETED" && !r.loan.feedbackGiven
                          ? "Leave feedback"
                          : "Open loan"}{" "}
                    <ArrowRight />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={withdrawing !== null}
        onClose={() => setWithdrawing(null)}
        title="Withdraw this request?"
        description="The owner will be told you no longer need it."
        confirmLabel="Withdraw request"
        tone="danger"
        onConfirm={async () => {
          if (!withdrawing) return;
          await cancel({ requestId: withdrawing });
          toast.success("Request withdrawn.");
        }}
      />
    </PageContainer>
  );
}

export default function MyRequestsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <MyRequests />
    </Suspense>
  );
}
