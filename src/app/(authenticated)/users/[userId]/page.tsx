"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { CATEGORY_LABELS } from "@convex/lib/constants";
import { Avatar } from "@/components/common/Avatar";
import { Badge, SampleTag, ToolStatusBadge } from "@/components/common/Badge";
import { EmptyState, LoadingState } from "@/components/common/States";
import { TrustBadge } from "@/components/common/TrustBadge";
import { PageContainer } from "@/components/layout/AppShell";
import { FeedbackList } from "@/components/profile/FeedbackList";
import { ReputationPreview } from "@/components/profile/ReputationPreview";
import { memberSince } from "@/lib/format";
import styles from "../../profile/profile.module.scss";

export default function UserProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const data = useQuery(api.users.reputation, { userId: userId as Id<"users"> });
  if (data === undefined) return <LoadingState />;
  if (data === null) return <EmptyState title="Member not found" />;
  const { user, reputation, feedback, listings } = data;
  return (
    <PageContainer>
      <div className={`${styles.grid} ${styles.top}`}>
        <div className={styles.main}>
          <section className={styles.card}>
            <div className={styles.identity}>
              <Avatar name={user.name} src={user.imageUrl} size={64} />
              <div>
                <h1 className={styles.name}>{user.name}</h1>
                <p className={styles.muted}>
                  {user.areaLabel ? `${user.areaLabel} · ` : ""}member since {memberSince(user.memberSince)}
                </p>
                <div className={styles.badges}>
                  {user.trustedLender && <TrustBadge />}
                  {user.isSeed && <SampleTag />}
                  {user.status !== "ACTIVE" && <Badge tone="danger">Suspended</Badge>}
                </div>
              </div>
            </div>
            {user.bio && <p>{user.bio}</p>}
          </section>
          <section className={styles.card}>
            <h2 className={styles.label}>Feedback from neighbours</h2>
            <FeedbackList items={feedback} />
          </section>
        </div>
        <aside className={styles.side}>
          <section className={styles.card}>
            <h2 className={styles.label}>Reputation</h2>
            <ReputationPreview reputation={reputation} />
          </section>
          <section className={styles.card}>
            <h2 className={styles.label}>Available to borrow</h2>
            {listings.length === 0 ? (
              <p className={styles.muted}>No tools listed right now.</p>
            ) : (
              <ul className={styles.plainList}>
                {listings.map((l) => (
                  <li key={l.id}>
                    <Link href={`/explore?tool=${l.id}`} className={styles.link}>
                      {l.name}
                    </Link>{" "}
                    <span className={styles.muted}>· {CATEGORY_LABELS[l.category]}</span> <ToolStatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </PageContainer>
  );
}
