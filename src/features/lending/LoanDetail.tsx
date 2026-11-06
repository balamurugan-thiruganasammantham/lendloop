"use client";

import clsx from "clsx";
import { useMutation, useQuery } from "convex/react";
import { AlertTriangle, ArrowLeft, Check, Flag, PackageCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS, type LoanStatus } from "@convex/lib/constants";
import { Avatar } from "@/components/common/Avatar";
import { LoanStatusBadge, SampleTag } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Field, Textarea } from "@/components/common/Field";
import { Rating } from "@/components/common/Stars";
import { EmptyState, InlineAlert, LoadingState } from "@/components/common/States";
import { useToast } from "@/components/common/Toast";
import { ToolThumb } from "@/components/common/ToolThumb";
import { TrustBadge } from "@/components/common/TrustBadge";
import { PageContainer } from "@/components/layout/AppShell";
import { ReputationPreview } from "@/components/profile/ReputationPreview";
import { FeedbackSection } from "@/features/feedback/FeedbackSection";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatRange, relativeTime } from "@/lib/format";
import { AUDIT_ACTION_LABELS, LOAN_STATUS_META } from "@/lib/status";
import { ShowCodePanel, VerifyCodePanel } from "./CodePanels";
import styles from "./LoanDetail.module.scss";
import { PickupCard } from "./PickupCard";
import { DamageDialog, DamageResponse, NotReturnedDialog, ReturnForm } from "./ReturnPanels";

const STEPS = ["Approved", "Pickup", "In use", "Return", "Completed"] as const;

function stepIndex(status: LoanStatus): number {
  switch (status) {
    case "APPROVED":
    case "COLLECTION_OTP_PENDING":
      return 1;
    case "COLLECTED":
    case "ACTIVE_LOAN":
    case "OVERDUE":
      return 2;
    case "COMPLETED":
      return 5;
    case "CANCELLED":
      return -1;
    default:
      return 3;
  }
}

export function LoanDetail({ loanId }: { loanId: Id<"loans"> }) {
  const loan = useQuery(api.loans.get, { loanId });
  const cancel = useMutation(api.loans.cancel);
  const confirmReturn = useMutation(api.loans.confirmReturnReady);
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [damageOpen, setDamageOpen] = useState(false);
  const [notReturnedOpen, setNotReturnedOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (loan === undefined) return <LoadingState label="Loading loan…" />;
  if (loan === null) {
    return (
      <PageContainer>
        <EmptyState title="Loan not found" description="It doesn't exist or you're not part of it." action={<Link href="/loans">Back to loans</Link>} />
      </PageContainer>
    );
  }

  const isBorrower = loan.role === "BORROWER";
  const isOwner = loan.role === "OWNER";
  const counterpart = isBorrower ? loan.owner : loan.borrower;
  const counterpartName = counterpart?.name ?? "the other member";
  const can = (a: (typeof loan.actions)[number]) => loan.actions.includes(a);
  const step = stepIndex(loan.status);
  const meta = LOAN_STATUS_META[loan.status];
  const openDamage = loan.damageReports.find((d) => d.status === "OPEN");

  const doConfirmReturn = async () => {
    setConfirming(true);
    try {
      await confirmReturn({ loanId });
      toast.info("Return code sent to the borrower. Ask them to read it to you.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setConfirming(false);
    }
  };

  return (
    <PageContainer>
      <div className={styles.back}>
        <Link href={isBorrower ? "/requests" : "/loans"}>
          <ArrowLeft aria-hidden /> {isBorrower ? "My requests" : "Loans"}
        </Link>
      </div>

      <header className={styles.header}>
        <ToolThumb src={loan.tool.images[0] ?? null} category={loan.tool.category} size={72} />
        <div className={styles.headerText}>
          <div className={styles.titleLine}>
            <h1>{loan.tool.name}</h1>
            <LoanStatusBadge status={loan.status} />
          </div>
          <p className={styles.sub}>
            {isBorrower ? "Borrowing from" : isOwner ? "Lending to" : "Between"} <strong>{counterpartName}</strong> · {CATEGORY_LABELS[loan.tool.category]} ·{" "}
            {formatRange(loan.pickupAt, loan.returnBy)}
          </p>
          <p className={styles.hint}>{meta.hint}</p>
        </div>
      </header>

      {step > 0 ? (
        <ol className={styles.stepper} aria-label="Loan progress">
          {STEPS.map((label, i) => (
            <li key={label} className={clsx(i < step && styles.done, i === step && styles.current)} aria-current={i === step ? "step" : undefined}>
              <span className={styles.stepDot}>{i < step ? <Check aria-hidden /> : i + 1}</span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
      ) : (
        <InlineAlert tone="info">This loan was cancelled{loan.cancelReason ? `: ${loan.cancelReason}` : "."}</InlineAlert>
      )}

      <div className={styles.grid}>
        <div className={styles.mainCol}>
          {loan.status === "OVERDUE" && (
            <InlineAlert tone="danger">
              <AlertTriangle size={13} /> This loan was due back {relativeTime(loan.returnBy)}.{" "}
              {isBorrower ? "Start the return or contact the owner." : "We've reminded the borrower."}
            </InlineAlert>
          )}
          {loan.status === "DISPUTED" && (
            <InlineAlert tone="danger">
              Under admin review{loan.disputeReason ? `: “${loan.disputeReason}”` : "."} {isOwner && "If the tool comes back, you can still verify the return below."}
            </InlineAlert>
          )}
          {loan.disputeOutcome && loan.status !== "DISPUTED" && (
            <InlineAlert tone="info">
              Admin resolution: {loan.disputeOutcome.replace("_", " ").toLowerCase()}
              {loan.disputeResolutionNote ? ` — ${loan.disputeResolutionNote}` : ""}
            </InlineAlert>
          )}

          {/* Collection */}
          {isBorrower && can("GET_PICKUP_CODE") && <ShowCodePanel loanId={loanId} purpose="COLLECTION" ownerName={counterpartName} meta={loan.otp.collection} />}
          {isOwner && can("VERIFY_PICKUP") && <VerifyCodePanel loanId={loanId} purpose="COLLECTION" borrowerName={counterpartName} meta={loan.otp.collection} />}

          {/* In use */}
          {isBorrower && can("REQUEST_RETURN") && <ReturnForm loanId={loanId} ownerName={counterpartName} />}
          {isOwner && (loan.status === "ACTIVE_LOAN" || loan.status === "OVERDUE") && (
            <div className={styles.actionCard}>
              <div>
                <h3>With {counterpartName}</h3>
                <p>
                  Due back {formatDateTime(loan.returnBy)}. You&apos;ll be notified when they start the return.
                </p>
              </div>
              {can("REPORT_NOT_RETURNED") && (
                <Button variant="danger" icon={<Flag />} onClick={() => setNotReturnedOpen(true)}>
                  Report not returned
                </Button>
              )}
            </div>
          )}

          {/* Return review (owner) */}
          {isOwner && loan.status === "RETURN_REQUESTED" && (
            <section className={styles.card}>
              <header className={styles.cardHead}>
                <h2>
                  <PackageCheck aria-hidden /> {counterpartName} is ready to return your item
                </h2>
              </header>
              <div className={styles.cardBody}>
                <div className={styles.compare}>
                  <figure>
                    <figcaption>Original listing</figcaption>
                    <div className={styles.photoRow}>
                      {loan.tool.images.length ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        loan.tool.images.slice(0, 3).map((src) => <img key={src} src={src} alt="Original listing" />)
                      ) : (
                        <ToolThumb src={null} category={loan.tool.category} size={96} />
                      )}
                    </div>
                  </figure>
                  <figure>
                    <figcaption>Return photos</figcaption>
                    <div className={styles.photoRow}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {loan.returnSubmission?.photos.map((src) => <img key={src} src={src} alt="Returned tool" />)}
                    </div>
                  </figure>
                </div>
                {loan.returnSubmission?.notes && <blockquote className={styles.quote}>“{loan.returnSubmission.notes}”</blockquote>}
                <dl className={styles.facts}>
                  <div>
                    <dt>Expected return</dt>
                    <dd>{formatDateTime(loan.returnBy)}</dd>
                  </div>
                  <div>
                    <dt>Return started</dt>
                    <dd className={clsx(loan.lateReturn && styles.lateText)}>
                      {loan.returnRequestedAt ? formatDateTime(loan.returnRequestedAt) : "—"} {loan.lateReturn && "(late)"}
                    </dd>
                  </div>
                </dl>
                <div className={styles.buttonRow}>
                  <Button variant="primary" icon={<Check />} loading={confirming} onClick={doConfirmReturn}>
                    Confirm returned
                  </Button>
                  <Button variant="danger" onClick={() => setDamageOpen(true)}>
                    Report damage
                  </Button>
                  <Button variant="ghost" onClick={() => setNotReturnedOpen(true)}>
                    Report not returned
                  </Button>
                </div>
              </div>
            </section>
          )}
          {isBorrower && loan.status === "RETURN_REQUESTED" && (
            <div className={styles.actionCard}>
              <div>
                <h3>Waiting for {counterpartName}</h3>
                <p>They&apos;ve been notified. When you meet, they&apos;ll confirm and you&apos;ll get a return code to read out.</p>
              </div>
            </div>
          )}

          {/* Return verification */}
          {isBorrower && can("GET_RETURN_CODE") && <ShowCodePanel loanId={loanId} purpose="RETURN" ownerName={counterpartName} meta={loan.otp.return} />}
          {isOwner && can("VERIFY_RETURN") && (
            <>
              <VerifyCodePanel loanId={loanId} purpose="RETURN" borrowerName={counterpartName} meta={loan.otp.return} />
              <div className={styles.buttonRow}>
                <Button variant="danger" size="sm" onClick={() => setDamageOpen(true)}>
                  Report damage instead
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setNotReturnedOpen(true)}>
                  Report not returned
                </Button>
              </div>
            </>
          )}

          {/* Damage & disputes */}
          {loan.damageReports.length > 0 && (
            <section className={styles.card}>
              <header className={styles.cardHead}>
                <h2>
                  <AlertTriangle aria-hidden /> Damage report{loan.damageReports.length > 1 ? "s" : ""}
                </h2>
              </header>
              <div className={styles.cardBody}>
                {loan.damageReports.map((d) => (
                  <article key={d.id} className={styles.damage}>
                    <p className={styles.damageStatus}>
                      {d.status === "OPEN"
                        ? "Awaiting borrower response"
                        : d.status === "ACKNOWLEDGED"
                          ? "Acknowledged by borrower"
                          : d.status === "CONTESTED"
                            ? "Contested — awaiting admin review"
                            : d.status === "UPHELD"
                              ? "Upheld by admin"
                              : "Dismissed by admin"}{" "}
                      · {relativeTime(d.createdAt)}
                    </p>
                    <p>{d.description}</p>
                    {d.evidence.length > 0 && (
                      <div className={styles.photoRow}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {d.evidence.map((src) => <img key={src} src={src} alt="Damage evidence" />)}
                      </div>
                    )}
                    {d.borrowerResponse && <blockquote className={styles.quote}>Borrower: “{d.borrowerResponse}”</blockquote>}
                    {d.resolutionNote && <p className={styles.hint}>Admin note: {d.resolutionNote}</p>}
                    {isBorrower && d.status === "OPEN" && <DamageResponse reportId={d.id} />}
                  </article>
                ))}
                {isOwner && can("CONFIRM_RETURN") && loan.status !== "RETURN_REQUESTED" && (
                  <div className={styles.actionCard}>
                    <div>
                      <h3>{loan.status === "DISPUTED" ? "Got the tool back?" : "Ready to close?"}</h3>
                      <p>
                        {openDamage
                          ? "You can wait for the borrower's response, or confirm the hand-back now — the report stays on record."
                          : "Confirm the final hand-back with a return code."}
                      </p>
                    </div>
                    <Button variant="primary" loading={confirming} onClick={doConfirmReturn}>
                      Confirm final return
                    </Button>
                  </div>
                )}
              </div>
            </section>
          )}
          {isOwner && loan.status === "DISPUTED" && loan.damageReports.length === 0 && can("CONFIRM_RETURN") && (
            <div className={styles.actionCard}>
              <div>
                <h3>Got the tool back?</h3>
                <p>Verify the return with a code and the loan will close normally.</p>
              </div>
              <Button variant="primary" loading={confirming} onClick={doConfirmReturn}>
                Verify return
              </Button>
            </div>
          )}

          {/* Location */}
          {loan.pickup && (
            <PickupCard
              loanId={loanId}
              pickup={loan.pickup}
              role={loan.role}
              instructions={loan.tool.instructions}
              returnArrangement={loan.returnArrangement}
              canEditArrangement={can("SET_RETURN_ARRANGEMENT")}
            />
          )}

          {/* Feedback */}
          {loan.status === "COMPLETED" && (isBorrower || isOwner) && (
            <section className={styles.card}>
              <div className={styles.cardBody}>
                <FeedbackSection
                  loanId={loanId}
                  role={isBorrower ? "BORROWER" : "OWNER"}
                  counterpartName={counterpartName}
                  mine={loan.feedback.mine}
                  theirs={loan.feedback.theirs}
                  canLeave={can("LEAVE_FEEDBACK")}
                />
              </div>
            </section>
          )}

          {can("CANCEL") && (
            <div className={styles.cancelRow}>
              <Button variant="ghost" size="sm" onClick={() => setCancelOpen(true)}>
                Cancel this loan
              </Button>
            </div>
          )}
        </div>

        <aside className={styles.sideCol}>
          {counterpart && (
            <section className={styles.card}>
              <div className={styles.cardBody}>
                <div className={styles.person}>
                  <Avatar name={counterpart.name} src={counterpart.imageUrl} size={44} />
                  <div>
                    <p className={styles.personName}>
                      {counterpart.name} {counterpart.trustedLender && <TrustBadge compact />} {counterpart.isSeed && <SampleTag />}
                    </p>
                    <Rating value={counterpart.averageRating} count={counterpart.reviewCount} />
                  </div>
                  <Link href={`/users/${counterpart.id}`} className={styles.textLink}>
                    Profile
                  </Link>
                </div>
                {loan.borrower?.reputation && !isBorrower && <ReputationPreview reputation={loan.borrower.reputation} />}
              </div>
            </section>
          )}
          <section className={styles.card}>
            <header className={styles.cardHead}>
              <h2>Timeline</h2>
            </header>
            <ol className={styles.timeline}>
              {loan.timeline.map((e) => (
                <li key={e.id}>
                  <span className={styles.tlDot} aria-hidden />
                  <div>
                    <p className={styles.tlTitle}>
                      {e.action === "loan.status_changed" && e.toStatus
                        ? LOAN_STATUS_META[e.toStatus as LoanStatus]?.label ?? e.toStatus
                        : (AUDIT_ACTION_LABELS[e.action] ?? e.action)}
                    </p>
                    <p className={styles.tlMeta}>
                      {e.actor === "BORROWER" ? (isBorrower ? "You" : counterpartName) : e.actor === "OWNER" ? (isOwner ? "You" : counterpartName) : e.actor === "SYSTEM" ? "LendLoop" : e.actor === "ADMIN" ? "Admin" : "—"}{" "}
                      · {formatDateTime(e.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this loan?"
        description={`${counterpartName} will be notified and the dates become free again.`}
        confirmLabel="Cancel loan"
        tone="danger"
        onConfirm={async () => {
          await cancel({ loanId, reason: cancelReason.trim() || undefined });
          toast.info("Loan cancelled.");
        }}
      >
        <Field label="Reason" optional>
          {(id) => <Textarea id={id} rows={2} maxLength={500} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />}
        </Field>
      </ConfirmDialog>
      <DamageDialog loanId={loanId} open={damageOpen} onClose={() => setDamageOpen(false)} />
      <NotReturnedDialog loanId={loanId} open={notReturnedOpen} onClose={() => setNotReturnedOpen(false)} />
    </PageContainer>
  );
}
