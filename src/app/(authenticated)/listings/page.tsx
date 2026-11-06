"use client";

import { useMutation, useQuery } from "convex/react";
import { Eye, Pause, Pencil, Play, Plus, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@convex/lib/constants";
import { LoanStatusBadge, SampleTag, ToolStatusBadge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingState } from "@/components/common/States";
import { useToast } from "@/components/common/Toast";
import { ToolThumb } from "@/components/common/ToolThumb";
import { PageContainer } from "@/components/layout/AppShell";
import { errorMessage } from "@/lib/errors";
import { formatRange, plural, relativeTime } from "@/lib/format";
import styles from "@/styles/pages/lists.module.scss";

export default function MyListingsPage() {
  const tools = useQuery(api.tools.mine, {});
  const setListed = useMutation(api.tools.setListed);
  const remove = useMutation(api.tools.remove);
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: Id<"tools">; name: string } | null>(null);

  const toggle = async (id: Id<"tools">, listed: boolean) => {
    setBusy(id);
    try {
      await setListed({ toolId: id, listed });
      toast.success(listed ? "Listing is visible on the map again." : "Listing paused. Pending requests were declined.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Lending"
        title="My Listings"
        description="Tools you're offering to neighbours. Status updates automatically as requests and loans progress."
        actions={
          <Link href="/listings/new" className={styles.primaryLink}>
            <Plus aria-hidden /> List a tool
          </Link>
        }
      />
      {tools === undefined ? (
        <LoadingState rows={4} />
      ) : tools.length === 0 ? (
        <EmptyState
          icon={<Wrench />}
          title="You haven't listed anything yet"
          description="List a tool you rarely use. You stay in control: approve every request and verify every hand-over."
          action={
            <Link href="/listings/new" className={styles.primaryLink}>
              List your first tool
            </Link>
          }
        />
      ) : (
        <ul className={styles.list}>
          {tools.map((t) => (
            <li key={t.id} className={styles.row}>
              <ToolThumb src={t.imageUrl} category={t.category} size={72} />
              <div className={styles.main}>
                <div className={styles.titleLine}>
                  <h2 className={styles.title}>{t.name}</h2>
                  <ToolStatusBadge status={t.status} />
                  {t.isSeed && <SampleTag />}
                </div>
                <p className={styles.meta}>
                  {CATEGORY_LABELS[t.category]} · {CONDITION_LABELS[t.condition]} · {t.pickupArea}
                </p>
                <p className={styles.meta}>
                  {t.pendingRequests > 0 ? (
                    <Link href="/incoming" className={styles.inlineLink}>
                      {plural(t.pendingRequests, "pending request")}
                    </Link>
                  ) : (
                    "No pending requests"
                  )}{" "}
                  · updated {relativeTime(t.updatedAt)}
                </p>
                {t.openLoans.length > 0 && (
                  <ul className={styles.subList}>
                    {t.openLoans.map((l) => (
                      <li key={l.id}>
                        <Link href={`/loans/${l.id}`}>
                          <LoanStatusBadge status={l.status} /> <span>{formatRange(l.pickupAt, l.returnBy)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className={styles.actions}>
                <Link href={`/explore?tool=${t.id}`} className={styles.iconLink} title="View on map" aria-label={`View ${t.name} on map`}>
                  <Eye />
                </Link>
                <Link href={`/listings/${t.id}/edit`} className={styles.iconLink} title="Edit" aria-label={`Edit ${t.name}`}>
                  <Pencil />
                </Link>
                {t.isListed ? (
                  <Button size="sm" icon={<Pause />} loading={busy === t.id} onClick={() => void toggle(t.id, false)}>
                    Pause
                  </Button>
                ) : (
                  <Button size="sm" icon={<Play />} loading={busy === t.id} onClick={() => void toggle(t.id, true)}>
                    Resume
                  </Button>
                )}
                <Button size="sm" variant="ghost" icon={<Trash2 />} aria-label={`Delete ${t.name}`} onClick={() => setDeleting({ id: t.id, name: t.name })} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        description="The listing is removed from the map. Pending requests are declined; past loans and reviews are kept."
        confirmLabel="Delete listing"
        tone="danger"
        onConfirm={async () => {
          if (!deleting) return;
          await remove({ toolId: deleting.id });
          toast.success("Listing deleted.");
        }}
      />
    </PageContainer>
  );
}
