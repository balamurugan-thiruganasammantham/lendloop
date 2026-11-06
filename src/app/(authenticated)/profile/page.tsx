"use client";

import { useClerk } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { ExternalLink, Phone, Shield } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import { Avatar } from "@/components/common/Avatar";
import { Badge } from "@/components/common/Badge";
import { Button } from "@/components/common/Button";
import { PageHeader } from "@/components/common/PageHeader";
import { InlineAlert, LoadingState } from "@/components/common/States";
import { TrustBadge } from "@/components/common/TrustBadge";
import { PageContainer } from "@/components/layout/AppShell";
import { FeedbackList } from "@/components/profile/FeedbackList";
import { ReputationPreview } from "@/components/profile/ReputationPreview";
import { ProfileForm } from "@/features/authentication/ProfileForm";
import { useViewer } from "@/features/authentication/ViewerContext";
import { memberSince } from "@/lib/format";
import styles from "./profile.module.scss";

export default function ProfilePage() {
  const viewer = useViewer();
  const { openUserProfile } = useClerk();
  const rep = useQuery(api.users.reputation, { userId: viewer.id });
  return (
    <PageContainer>
      <PageHeader eyebrow="Account" title="Profile" />
      <div className={styles.grid}>
        <div className={styles.main}>
          <section className={styles.card}>
            <div className={styles.identity}>
              <Avatar name={viewer.name} src={viewer.imageUrl} size={64} />
              <div>
                <h2>{viewer.name}</h2>
                <p className={styles.muted}>
                  {viewer.email} · member since {memberSince(viewer.createdAt)}
                </p>
                <div className={styles.badges}>
                  {viewer.trustedLender && <TrustBadge />}
                  {viewer.role === "ADMIN" && (
                    <Badge tone="ink">
                      <Shield size={11} /> Admin
                    </Badge>
                  )}
                  <Badge tone={viewer.status === "ACTIVE" ? "success" : "danger"}>{viewer.status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
                </div>
              </div>
            </div>
            {viewer.status === "SUSPENDED" && <InlineAlert tone="danger">Your account is suspended{viewer.suspendedReason ? `: ${viewer.suspendedReason}` : "."}</InlineAlert>}
            <div className={styles.account}>
              <p>
                <Phone size={14} aria-hidden />{" "}
                {viewer.phoneNumber ? (
                  <>
                    {viewer.phoneNumber} <Badge tone="success">Verified</Badge>
                  </>
                ) : (
                  <span className={styles.muted}>No verified phone number (optional)</span>
                )}
              </p>
              <Button size="sm" icon={<ExternalLink />} onClick={() => openUserProfile()}>
                Email, phone &amp; security
              </Button>
            </div>
            <p className={styles.fine}>Email, password and phone verification are managed securely by Clerk. Only verified numbers are synced.</p>
          </section>
          <section className={styles.card}>
            <h3 className={styles.label}>Public profile</h3>
            <ProfileForm />
          </section>
        </div>
        <aside className={styles.side}>
          <section className={styles.card}>
            <h3 className={styles.label}>Your reputation</h3>
            <ReputationPreview reputation={viewer.reputation} />
            <p className={styles.fine}>
              Listed items: <span className="num">{viewer.stats.itemsListed}</span> ·{" "}
              <Link href={`/users/${viewer.id}`} className={styles.link}>
                View as others see it
              </Link>
            </p>
          </section>
          <section className={styles.card}>
            <h3 className={styles.label}>Recent feedback</h3>
            {rep === undefined ? <LoadingState /> : <FeedbackList items={rep?.feedback ?? []} />}
          </section>
        </aside>
      </div>
    </PageContainer>
  );
}
