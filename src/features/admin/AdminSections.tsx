"use client";

import { useMutation, useQuery } from "convex/react";
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS, FEEDBACK_TAG_LABELS, LOAN_STATUSES, type DisputeOutcome, type LoanStatus } from "@convex/lib/constants";
import { Badge, LoanStatusBadge, SampleTag, ToolStatusBadge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { Field, Input, Select, Textarea } from "@/components/common/Field";
import { Rating } from "@/components/common/Stars";
import { EmptyState, InlineAlert, LoadingState } from "@/components/common/States";
import { useToast } from "@/components/common/Toast";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatRange, relativeTime } from "@/lib/format";
import { LOAN_STATUS_META } from "@/lib/status";
import styles from "./Admin.module.scss";

function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: boolean }) {
  if (empty) return <EmptyState compact title="Nothing to show" />;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Admin actions require a note for the audit trail. */
function NoteAction({
  label,
  title,
  tone = "primary",
  onConfirm,
  extra,
}: {
  label: string;
  title: string;
  tone?: "primary" | "danger";
  onConfirm: (note: string) => Promise<unknown>;
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <>
      <Button size="sm" variant={tone === "danger" ? "danger" : "secondary"} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setNote("");
        }}
        title={title}
        confirmLabel={label}
        tone={tone}
        onConfirm={async () => {
          await onConfirm(note);
          setNote("");
        }}
      >
        {extra}
        <Field label="Note for the audit log" hint="5–500 characters. Shared with the affected members.">
          {(id) => <Textarea id={id} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </ConfirmDialog>
    </>
  );
}

export function AdminOverview({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const o = useQuery(api.admin.overview, {});
  if (!o) return <LoadingState />;
  const cards: [string, number, string, boolean][] = [
    ["Members", o.users, "users", false],
    ["Suspended", o.suspended, "users", o.suspended > 0],
    ["Tools on the map", o.discoverableTools, "listings", false],
    ["Open disputes", o.disputes, "disputes", o.disputes > 0],
    ["Loans with damage reported", o.damageReported, "disputes", o.damageReported > 0],
    ["Damage reports to review", o.openDamageReports, "damage", o.openDamageReports > 0],
    ["Reported feedback", o.openReports, "reports", o.openReports > 0],
    ["Automation failures", o.automationFailures + o.deadEvents, "automation", o.automationFailures + o.deadEvents > 0],
  ];
  return (
    <div className={styles.stats}>
      {cards.map(([label, n, tab, attention]) => (
        <button key={label} type="button" className={attention ? styles.statAttention : styles.stat} onClick={() => onNavigate(tab)}>
          <span className={styles.statLabel}>{label}</span>
          <span className={`${styles.statValue} num`}>{n >= 1000 ? "1000+" : n}</span>
        </button>
      ))}
    </div>
  );
}

export function AdminUsers() {
  const [search, setSearch] = useState("");
  const users = useQuery(api.admin.users, { search: search || undefined });
  const setTrusted = useMutation(api.admin.setTrusted);
  const setStatus = useMutation(api.admin.setStatus);
  const toast = useToast();
  return (
    <div className={styles.stack}>
      <Input placeholder="Search by name or email" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search users" className={styles.search} />
      {users === undefined ? (
        <LoadingState />
      ) : (
        <Table head={["Member", "Role", "Status", "Reputation", "Joined", ""]} empty={users.length === 0}>
          {users.map((u) => (
            <tr key={u.id}>
              <td>
                <Link href={`/users/${u.id}`} className={styles.strong}>
                  {u.name}
                </Link>{" "}
                {u.isSeed && <SampleTag />}
                <div className={styles.muted}>{u.email}</div>
              </td>
              <td>
                <Badge tone={u.role === "ADMIN" ? "ink" : "neutral"}>{u.role}</Badge> {u.trustedLender && <Badge tone="accent">Trusted</Badge>}
              </td>
              <td>
                <Badge tone={u.status === "ACTIVE" ? "success" : "danger"}>{u.status}</Badge>
                {u.suspendedReason && <div className={styles.muted}>{u.suspendedReason}</div>}
              </td>
              <td>
                <Rating value={u.reputation.averageRating} count={u.reputation.reviewCount} />
                <div className={styles.muted}>
                  {u.reputation.verified.completedTransactions} completed · {u.itemsListed} listed
                </div>
              </td>
              <td className={styles.muted}>{relativeTime(u.createdAt)}</td>
              <td className={styles.actions}>
                <Button
                  size="sm"
                  onClick={() =>
                    setTrusted({ userId: u.id, trusted: !u.trustedLender })
                      .then(() => toast.success(u.trustedLender ? "Trusted status removed." : "Marked as Trusted Lender."))
                      .catch((e) => toast.error(errorMessage(e)))
                  }
                >
                  {u.trustedLender ? "Remove trusted" : "Mark trusted"}
                </Button>
                {u.status === "ACTIVE" ? (
                  <NoteAction
                    label="Suspend"
                    tone="danger"
                    title={`Suspend ${u.name}?`}
                    onConfirm={(note) => setStatus({ userId: u.id, status: "SUSPENDED", reason: note }).then(() => toast.success("Account suspended."))}
                  />
                ) : (
                  <Button
                    size="sm"
                    onClick={() =>
                      setStatus({ userId: u.id, status: "ACTIVE" })
                        .then(() => toast.success("Account reinstated."))
                        .catch((e) => toast.error(errorMessage(e)))
                    }
                  >
                    Reinstate
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function AdminTools() {
  const [includeRemoved, setIncludeRemoved] = useState(false);
  const tools = useQuery(api.admin.tools, { includeRemoved });
  const removeTool = useMutation(api.admin.removeTool);
  const restoreTool = useMutation(api.admin.restoreTool);
  const toast = useToast();
  return (
    <div className={styles.stack}>
      <label className={styles.check}>
        <input type="checkbox" checked={includeRemoved} onChange={(e) => setIncludeRemoved(e.target.checked)} /> Include removed listings
      </label>
      {tools === undefined ? (
        <LoadingState />
      ) : (
        <Table head={["Listing", "Owner", "Status", ""]} empty={tools.length === 0}>
          {tools.map((t) => (
            <tr key={t.id}>
              <td>
                <span className={styles.strong}>{t.name}</span> {t.isSeed && <SampleTag />}
                <div className={styles.muted}>
                  {CATEGORY_LABELS[t.category]} · {t.pickupArea}
                </div>
              </td>
              <td>
                {t.owner?.name}
                <div className={styles.muted}>{t.owner?.email}</div>
              </td>
              <td>
                <ToolStatusBadge status={t.status} />
                {t.removedReason && <div className={styles.muted}>{t.removedReason}</div>}
              </td>
              <td className={styles.actions}>
                {t.removed ? (
                  <Button
                    size="sm"
                    onClick={() =>
                      restoreTool({ toolId: t.id })
                        .then(() => toast.success("Listing restored."))
                        .catch((e) => toast.error(errorMessage(e)))
                    }
                  >
                    Restore
                  </Button>
                ) : (
                  <NoteAction
                    label="Remove"
                    tone="danger"
                    title={`Remove “${t.name}”?`}
                    onConfirm={(note) => removeTool({ toolId: t.id, reason: note }).then(() => toast.success("Listing removed."))}
                  />
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function AdminLoans() {
  const [status, setStatus] = useState<LoanStatus | "">("");
  const loans = useQuery(api.admin.loans, { status: status || undefined });
  return (
    <div className={styles.stack}>
      <Select value={status} onChange={(e) => setStatus(e.target.value as LoanStatus | "")} aria-label="Filter by status" className={styles.search}>
        <option value="">All statuses</option>
        {LOAN_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LOAN_STATUS_META[s].label}
          </option>
        ))}
      </Select>
      {loans === undefined ? (
        <LoadingState />
      ) : (
        <Table head={["Tool", "Owner → borrower", "Dates", "Status", "Updated"]} empty={loans.length === 0}>
          {loans.map((l) => (
            <tr key={l.id}>
              <td>
                <Link href={`/loans/${l.id}`} className={styles.strong}>
                  {l.toolName}
                </Link>
              </td>
              <td>
                {l.owner?.name} → {l.borrower?.name}
              </td>
              <td className={styles.muted}>{formatRange(l.pickupAt, l.returnBy)}</td>
              <td>
                <LoanStatusBadge status={l.status} /> {l.wasOverdue && <Badge tone="warn">Was overdue</Badge>}
              </td>
              <td className={styles.muted}>{relativeTime(l.updatedAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

export function AdminDisputes() {
  const disputes = useQuery(api.admin.disputes, {});
  const resolve = useMutation(api.admin.resolveDispute);
  const toast = useToast();
  const [outcome, setOutcome] = useState<DisputeOutcome>("RETURNED");
  if (disputes === undefined) return <LoadingState />;
  if (disputes.length === 0) return <EmptyState title="No open disputes" description="Disputed loans and loans with damage reported appear here." />;
  return (
    <ul className={styles.cards}>
      {disputes.map((d) => (
        <li key={d.id} className={styles.card}>
          <div className={styles.cardHead}>
            <Link href={`/loans/${d.id}`} className={styles.strong}>
              {d.toolName}
            </Link>
            <LoanStatusBadge status={d.status} />
          </div>
          <p className={styles.muted}>
            {d.owner?.name} (owner) → {d.borrower?.name} (borrower) · {formatRange(d.pickupAt, d.returnBy)}
          </p>
          {d.disputeReason && <p>Reason: “{d.disputeReason}”</p>}
          {d.damageReports.map((r) => (
            <div key={r.id} className={styles.sub}>
              <Badge tone="danger">Damage · {r.status.toLowerCase()}</Badge> {r.description}
              {r.borrowerResponse && <div className={styles.muted}>Borrower: “{r.borrowerResponse}”</div>}
            </div>
          ))}
          {d.status === "DISPUTED" ? (
            <div className={styles.actions}>
              <NoteAction
                label="Resolve dispute"
                title="Resolve dispute"
                extra={
                  <Field label="Outcome">
                    {(id) => (
                      <Select id={id} value={outcome} onChange={(e) => setOutcome(e.target.value as DisputeOutcome)}>
                        <option value="RETURNED">Tool returned — complete the loan</option>
                        <option value="NOT_RETURNED">Confirmed not returned — record incident</option>
                        <option value="REOPEN">Reopen — loan continues as active</option>
                      </Select>
                    )}
                  </Field>
                }
                onConfirm={(note) => resolve({ loanId: d.id, outcome, note }).then(() => toast.success("Dispute resolved."))}
              />
            </div>
          ) : (
            <p className={styles.muted}>Waiting for the borrower to respond to the damage report (or review it under Damage).</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AdminDamage() {
  const reports = useQuery(api.admin.damageReports, {});
  const review = useMutation(api.admin.reviewDamage);
  const toast = useToast();
  if (reports === undefined) return <LoadingState />;
  if (reports.length === 0) return <EmptyState title="No damage reports" />;
  return (
    <ul className={styles.cards}>
      {reports.map((r) => (
        <li key={r.id} className={styles.card}>
          <div className={styles.cardHead}>
            <Link href={`/loans/${r.loanId}`} className={styles.strong}>
              {r.toolName}
            </Link>
            <Badge tone={r.status === "UPHELD" || r.status === "ACKNOWLEDGED" ? "danger" : r.status === "DISMISSED" ? "neutral" : "warn"}>{r.status}</Badge>
          </div>
          <p className={styles.muted}>
            Reported by {r.reporter?.name} against {r.subject?.name} · {formatDateTime(r.createdAt)}
          </p>
          <p>{r.description}</p>
          {r.evidence.length > 0 && (
            <div className={styles.photos}>
              {r.evidence.map((src) => (
                <a key={src} href={src} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL */}
                  <img src={src} alt="Evidence" />
                </a>
              ))}
            </div>
          )}
          {r.borrowerResponse && <p className={styles.muted}>Borrower: “{r.borrowerResponse}”</p>}
          {r.resolutionNote && <p className={styles.muted}>Resolution: {r.resolutionNote}</p>}
          {(r.status === "OPEN" || r.status === "CONTESTED") && (
            <div className={styles.actions}>
              <NoteAction label="Uphold" tone="danger" title="Uphold this damage report?" onConfirm={(note) => review({ reportId: r.id, decision: "UPHOLD", note }).then(() => toast.success("Report upheld."))} />
              <NoteAction label="Dismiss" title="Dismiss this damage report?" onConfirm={(note) => review({ reportId: r.id, decision: "DISMISS", note }).then(() => toast.success("Report dismissed."))} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AdminReports() {
  const reports = useQuery(api.admin.reports, {});
  const review = useMutation(api.admin.reviewReport);
  const toast = useToast();
  if (reports === undefined) return <LoadingState />;
  if (reports.length === 0) return <EmptyState title="No reported feedback" />;
  return (
    <ul className={styles.cards}>
      {reports.map((r) => (
        <li key={r.id} className={styles.card}>
          <p className={styles.muted}>
            Reported by {r.reporter?.name} · {relativeTime(r.createdAt)}
          </p>
          <p>Reason: “{r.reason}”</p>
          {r.feedback && (
            <div className={styles.sub}>
              <Rating value={r.feedback.rating} /> by {r.feedback.author?.name}
              {r.feedback.comment && <p>“{r.feedback.comment}”</p>}
              <p className={styles.muted}>{r.feedback.tags.map((t) => FEEDBACK_TAG_LABELS[t]).join(" · ")}</p>
            </div>
          )}
          <div className={styles.actions}>
            <NoteAction label="Hide feedback" tone="danger" title="Hide this feedback?" onConfirm={(note) => review({ reportId: r.id, action: "HIDE_FEEDBACK", note }).then(() => toast.success("Feedback hidden."))} />
            <NoteAction label="Dismiss report" title="Dismiss this report?" onConfirm={(note) => review({ reportId: r.id, action: "DISMISS", note }).then(() => toast.success("Report dismissed."))} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AdminAutomation() {
  const data = useQuery(api.admin.automation, {});
  const retry = useMutation(api.admin.retryEvent);
  const resolve = useMutation(api.admin.resolveFailure);
  const toast = useToast();
  if (!data) return <LoadingState />;
  return (
    <div className={styles.stack}>
      <div className={styles.configRow}>
        <Badge tone={data.configured ? "success" : "warn"}>Outbound to n8n: {data.configured ? "configured" : "not configured"}</Badge>
        <Badge tone={data.inboundConfigured ? "success" : "warn"}>Inbound from n8n: {data.inboundConfigured ? "configured" : "not configured"}</Badge>
        <Badge tone={data.emailMode === "smtp" ? "success" : "info"}>OTP email: {data.emailMode}</Badge>
      </div>
      {!data.configured && (
        <InlineAlert tone="warn">
          N8N_WEBHOOK_URL / N8N_WEBHOOK_SECRET are not set, so email notifications are recorded as SKIPPED. In-app notifications still work.
        </InlineAlert>
      )}

      <h3 className={styles.h3}>Failures</h3>
      <Table head={["When", "Workflow", "Node", "Error", "Event", ""]} empty={data.failures.length === 0}>
        {data.failures.map((f) => (
          <tr key={f.id}>
            <td className={styles.muted}>{formatDateTime(f.occurredAt)}</td>
            <td>
              {f.workflowName}
              {f.executionId && <div className={styles.muted}>exec {f.executionId}</div>}
            </td>
            <td>{f.failedNode ?? "—"}</td>
            <td className={styles.error}>{f.errorMessage}</td>
            <td className={styles.mono}>{f.relatedEventId ?? "—"}</td>
            <td>
              {f.status === "OPEN" ? (
                <Button size="sm" onClick={() => resolve({ failureId: f.id }).catch((e) => toast.error(errorMessage(e)))}>
                  Mark resolved
                </Button>
              ) : (
                <Badge>Resolved</Badge>
              )}
            </td>
          </tr>
        ))}
      </Table>

      <h3 className={styles.h3}>Events needing attention</h3>
      <Table head={["Event", "Type", "Status", "Attempts", "Last error", ""]} empty={data.problemEvents.length === 0}>
        {data.problemEvents.map((e) => (
          <tr key={e.id}>
            <td className={styles.mono}>{e.eventId}</td>
            <td>{e.eventType}</td>
            <td>
              <Badge tone={e.status === "DEAD" ? "danger" : e.status === "FAILED" ? "warn" : "neutral"}>{e.status}</Badge>
              {e.nextAttemptAt && <div className={styles.muted}>retry {relativeTime(e.nextAttemptAt)}</div>}
            </td>
            <td className="num">{e.attempts}</td>
            <td className={styles.error}>{e.lastError ?? e.deliveryError ?? "—"}</td>
            <td>
              <Button
                size="sm"
                icon={<RotateCcw />}
                onClick={() =>
                  retry({ automationEventId: e.id as Id<"automationEvents"> })
                    .then(() => toast.success("Retry scheduled."))
                    .catch((err) => toast.error(errorMessage(err)))
                }
              >
                Retry
              </Button>
            </td>
          </tr>
        ))}
      </Table>

      <h3 className={styles.h3}>Recent deliveries</h3>
      <Table head={["Event", "Type", "Status", "n8n result", "Created"]} empty={data.recentEvents.length === 0}>
        {data.recentEvents.map((e) => (
          <tr key={e.id}>
            <td className={styles.mono}>{e.eventId}</td>
            <td>{e.eventType}</td>
            <td>
              <Badge tone={e.status === "DELIVERED" ? "success" : e.status === "DEAD" ? "danger" : "neutral"}>{e.status}</Badge>
            </td>
            <td>{e.deliveryResult ?? "—"}</td>
            <td className={styles.muted}>{relativeTime(e.createdAt)}</td>
          </tr>
        ))}
      </Table>

      <h3 className={styles.h3}>Workflow runs</h3>
      <Table head={["Workflow", "Execution", "Processed", "Sent", "Skipped", "Failed", "Finished"]} empty={data.runs.length === 0}>
        {data.runs.map((r) => (
          <tr key={r.id}>
            <td>{r.workflowName}</td>
            <td className={styles.mono}>{r.executionId ?? "—"}</td>
            <td className="num">{r.processed}</td>
            <td className="num">{r.sent}</td>
            <td className="num">{r.skipped}</td>
            <td className="num">{r.failed}</td>
            <td className={styles.muted}>{relativeTime(r.finishedAt)}</td>
          </tr>
        ))}
      </Table>

      <h3 className={styles.h3}>Overdue reminders</h3>
      <Table head={["Reminder", "Status", "Attempts", "Error", "Claimed"]} empty={data.reminders.length === 0}>
        {data.reminders.map((r) => (
          <tr key={r.id}>
            <td className={styles.mono}>{r.reminderKey}</td>
            <td>
              <Badge tone={r.status === "FAILED" ? "danger" : r.status === "CLAIMED" ? "warn" : "success"}>{r.status}</Badge>
            </td>
            <td className="num">{r.attempts}</td>
            <td className={styles.error}>{r.error ?? "—"}</td>
            <td className={styles.muted}>{relativeTime(r.claimedAt)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

export function AdminAudit() {
  const [resourceType, setResourceType] = useState("");
  const logs = useQuery(api.admin.auditLogs, { resourceType: resourceType || undefined, limit: 200 });
  return (
    <div className={styles.stack}>
      <Select value={resourceType} onChange={(e) => setResourceType(e.target.value)} aria-label="Resource type" className={styles.search}>
        <option value="">All resources</option>
        {["user", "tool", "request", "loan", "feedback", "damageReport", "userReport", "automation"].map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Select>
      {logs === undefined ? (
        <LoadingState />
      ) : (
        <Table head={["When", "Actor", "Action", "Resource", "Transition", "Details"]} empty={logs.length === 0}>
          {logs.map((l) => (
            <tr key={l.id}>
              <td className={styles.muted}>{formatDateTime(l.createdAt)}</td>
              <td>
                {l.actor ?? "—"} <Badge>{l.actorType}</Badge>
              </td>
              <td className={styles.mono}>{l.action}</td>
              <td className={styles.mono}>
                {l.resourceType}:{l.resourceId.slice(-8)}
              </td>
              <td>{l.fromStatus || l.toStatus ? `${l.fromStatus ?? "∅"} → ${l.toStatus ?? "∅"}` : "—"}</td>
              <td className={styles.muted}>
                {l.meta
                  ? Object.entries(l.meta)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(", ")
                  : "—"}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
