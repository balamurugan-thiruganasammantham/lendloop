"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowRight, Check, Inbox, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Avatar } from "@/components/common/Avatar";
import { LoanStatusBadge, RequestStatusBadge, SampleTag } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Field, Textarea } from "@/components/common/Field";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, InlineAlert, LoadingState } from "@/components/common/States";
import { Tabs } from "@/components/common/Tabs";
import { useToast } from "@/components/common/Toast";
import { ToolThumb } from "@/components/common/ToolThumb";
import { TrustBadge } from "@/components/common/TrustBadge";
import { PageContainer } from "@/components/layout/AppShell";
import { ReputationPreview } from "@/components/profile/ReputationPreview";
import { formatDate, formatDateTime, formatDuration, memberSince, relativeTime } from "@/lib/format";
import styles from "./incoming.module.scss";

type Status = "PENDING" | "APPROVED" | "DECLINED";

export default function IncomingRequestsPage() {
  const [status, setStatus] = useState<Status>("PENDING");
  const rows = useQuery(api.requests.incoming, { status });
  const approve = useMutation(api.requests.approve);
  const decline = useMutation(api.requests.decline);
  const toast = useToast();
  const [approving, setApproving] = useState<{ id: Id<"borrowRequests">; who: string; tool: string } | null>(null);
  const [declining, setDeclining] = useState<{ id: Id<"borrowRequests">; who: string } | null>(null);
  const [reason, setReason] = useState("");

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Lending"
        title="Incoming Requests"
        description="Neighbours who'd like to borrow your tools. Review their verified history before you approve."
      />
      <Tabs
        label="Request status"
        value={status}
        onChange={setStatus}
        items={[
          { key: "PENDING", label: "Awaiting you" },
          { key: "APPROVED", label: "Approved" },
          { key: "DECLINED", label: "Declined" },
        ]}
      />
      {rows === undefined ? (
        <LoadingState rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Inbox />} title={status === "PENDING" ? "No requests waiting" : "Nothing here yet"} description="New requests appear here instantly." />
      ) : (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={r.id} className={styles.card}>
              <div className={styles.requestCol}>
                <div className={styles.toolLine}>
                  <ToolThumb src={r.tool.imageUrl} category={r.tool.category} size={48} />
                  <div>
                    <p className={styles.toolName}>
                      {r.tool.name} {r.tool.isSeed && <SampleTag />}
                    </p>
                    <p className={styles.muted}>Requested {relativeTime(r.createdAt)}</p>
                  </div>
                  <span className={styles.badge}>{r.loan ? <LoanStatusBadge status={r.loan.status} /> : <RequestStatusBadge status={r.status} />}</span>
                </div>
                <dl className={styles.dates}>
                  <div>
                    <dt>Pickup</dt>
                    <dd>{formatDateTime(r.pickupAt)}</dd>
                  </div>
                  <div>
                    <dt>Return by</dt>
                    <dd>{formatDateTime(r.returnBy)}</dd>
                  </div>
                  <div>
                    <dt>Length</dt>
                    <dd className="num">{formatDuration(r.returnBy - r.pickupAt)}</dd>
                  </div>
                </dl>
                {r.message && <blockquote className={styles.message}>“{r.message}”</blockquote>}
                {r.hasConflict && (
                  <InlineAlert tone="warn">
                    <AlertTriangle size={13} /> These dates overlap a loan you&apos;ve already approved.
                  </InlineAlert>
                )}
                {r.declineReason && <p className={styles.muted}>Your note: “{r.declineReason}”</p>}
                <div className={styles.actions}>
                  {r.status === "PENDING" && r.borrower ? (
                    <>
                      <Button variant="primary" icon={<Check />} disabled={r.hasConflict || !r.borrower.active} onClick={() => setApproving({ id: r.id, who: r.borrower!.name, tool: r.tool.name })}>
                        Approve
                      </Button>
                      <Button icon={<X />} onClick={() => setDeclining({ id: r.id, who: r.borrower!.name })}>
                        Decline
                      </Button>
                    </>
                  ) : r.loan ? (
                    <Link href={`/loans/${r.loan.id}`} className={styles.link}>
                      Open loan <ArrowRight />
                    </Link>
                  ) : null}
                </div>
              </div>

              {r.borrower && (
                <aside className={styles.borrowerCol}>
                  <div className={styles.person}>
                    <Avatar name={r.borrower.name} src={r.borrower.imageUrl} size={40} />
                    <div>
                      <p className={styles.personName}>
                        {r.borrower.name} {r.borrower.trustedLender && <TrustBadge compact />} {r.borrower.isSeed && <SampleTag />}
                      </p>
                      <p className={styles.muted}>
                        {r.borrower.areaLabel ? `${r.borrower.areaLabel} · ` : ""}member since {memberSince(r.borrower.memberSince)}
                      </p>
                    </div>
                    <Link href={`/users/${r.borrower.id}`} className={styles.profile}>
                      Profile
                    </Link>
                  </div>
                  {!r.borrower.active && <InlineAlert tone="danger">This account is suspended and can&apos;t borrow.</InlineAlert>}
                  <ReputationPreview reputation={r.borrower.reputation} />
                  {r.borrower.recentLoans.length > 0 && (
                    <div>
                      <h4 className={styles.subhead}>Recent borrows</h4>
                      <ul className={styles.recent}>
                        {r.borrower.recentLoans.map((l) => (
                          <li key={l.id}>
                            <span>{l.toolName}</span>
                            <span className={l.late ? styles.late : styles.ok}>{l.late ? "Returned late" : "On time"}</span>
                            <span className={styles.muted}>{formatDate(l.completedAt)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {r.borrower.damageReports.length > 0 && (
                    <div>
                      <h4 className={styles.subhead}>Damage reports</h4>
                      <ul className={styles.recent}>
                        {r.borrower.damageReports.map((d) => (
                          <li key={d.id}>
                            <span>{formatDate(d.createdAt)}</span>
                            <span className={d.verified ? styles.late : styles.muted}>
                              {d.verified ? "Confirmed" : d.status === "DISMISSED" ? "Dismissed by admin" : "Unverified claim"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </aside>
              )}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={approving !== null}
        onClose={() => setApproving(null)}
        title={`Approve ${approving?.who}'s request?`}
        description={`They'll see your exact pickup point for the ${approving?.tool} and get a one-time pickup code. Overlapping requests are declined automatically.`}
        confirmLabel="Approve request"
        onConfirm={async () => {
          if (!approving) return;
          await approve({ requestId: approving.id });
          toast.success("Approved. The borrower now has pickup details.");
        }}
      />
      <ConfirmDialog
        open={declining !== null}
        onClose={() => {
          setDeclining(null);
          setReason("");
        }}
        title={`Decline ${declining?.who}'s request?`}
        confirmLabel="Decline request"
        tone="danger"
        onConfirm={async () => {
          if (!declining) return;
          await decline({ requestId: declining.id, reason: reason.trim() || undefined });
          setReason("");
          toast.info("Request declined.");
        }}
      >
        <Field label="Reason" optional hint="Shared with the borrower.">
          {(id) => <Textarea id={id} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sorry, I need it myself that weekend." />}
        </Field>
      </ConfirmDialog>
    </PageContainer>
  );
}
