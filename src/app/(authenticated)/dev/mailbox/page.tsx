"use client";

import { useQuery } from "convex/react";
import { Mail } from "lucide-react";
import { api } from "@convex/_generated/api";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, InlineAlert, LoadingState } from "@/components/common/States";
import { PageContainer } from "@/components/layout/AppShell";
import { formatDateTime } from "@/lib/format";
import styles from "./mailbox.module.scss";

/** Development-only view of mock email delivery (EMAIL_DELIVERY_MODE=mock). */
export default function DevMailboxPage() {
  const data = useQuery(api.devMailbox.mine, {});
  return (
    <PageContainer narrow>
      <PageHeader eyebrow="Development" title="Mock mailbox" description="Emails that would have been sent to you. Messages expire after 24 hours." />
      <InlineAlert tone="warn">
        Development mock mode: email delivery isn&apos;t configured, so messages (including hand-over codes) are stored here, visible only to you.
        Configure SMTP and set <code>EMAIL_DELIVERY_MODE=smtp</code> for real delivery.
      </InlineAlert>
      {data === undefined ? (
        <LoadingState />
      ) : !data.enabled ? (
        <EmptyState icon={<Mail />} title="Mock mailbox is disabled" description="This deployment sends real email." />
      ) : data.messages.length === 0 ? (
        <EmptyState icon={<Mail />} title="No messages" />
      ) : (
        <ul className={styles.list}>
          {data.messages.map((m) => (
            <li key={m.id}>
              <p className={styles.subject}>{m.subject}</p>
              <p className={styles.meta}>
                To {m.to} · {formatDateTime(m.createdAt)} · {m.kind}
              </p>
              <pre className={styles.body}>{m.text}</pre>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
