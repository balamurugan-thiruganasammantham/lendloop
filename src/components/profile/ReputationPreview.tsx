import clsx from "clsx";
import { Info } from "lucide-react";
import type { Reputation } from "@convex/lib/rules";
import { Rating } from "@/components/common/Stars";
import styles from "./ReputationPreview.module.scss";

function ageLabel(days: number): string {
  if (days < 1) return "New today";
  if (days < 31) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 365) return `${Math.floor(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}

/**
 * Reputation summary that keeps three kinds of information visibly apart:
 *  1. verified history — recorded by LendLoop from completed hand-overs;
 *  2. feedback — opinions submitted by other members;
 *  3. unverified reports — claims not yet confirmed (never shown as fact).
 */
export function ReputationPreview({ reputation, compact }: { reputation: Reputation; compact?: boolean }) {
  const v = reputation.verified;
  const u = reputation.unverified;
  const hasUnverified = u.openDamageReports > 0 || u.openNotReturnedReports > 0;
  return (
    <div className={clsx(styles.wrap, compact && styles.compact)}>
      <section>
        <h4 className={styles.label}>Verified history</h4>
        <dl className={styles.grid}>
          <div>
            <dt>Borrowed</dt>
            <dd className="num">{v.borrowingTotal}</dd>
          </div>
          <div>
            <dt>Returned</dt>
            <dd className="num">{v.successfulReturns}</dd>
          </div>
          <div>
            <dt>Late returns</dt>
            <dd className={clsx("num", v.lateReturns > 0 && styles.warn)}>{v.lateReturns}</dd>
          </div>
          <div>
            <dt>Lent</dt>
            <dd className="num">{v.successfulLends}</dd>
          </div>
          <div>
            <dt>Damage confirmed</dt>
            <dd className={clsx("num", v.damageIncidentsConfirmed > 0 && styles.warn)}>{v.damageIncidentsConfirmed}</dd>
          </div>
          <div>
            <dt>Member for</dt>
            <dd>{ageLabel(reputation.accountAgeDays)}</dd>
          </div>
        </dl>
        {v.notReturnedConfirmed > 0 && (
          <p className={styles.danger}>
            {v.notReturnedConfirmed} item{v.notReturnedConfirmed === 1 ? "" : "s"} confirmed not returned after admin review.
          </p>
        )}
      </section>
      <section className={styles.feedback}>
        <h4 className={styles.label}>Member feedback</h4>
        <Rating value={reputation.averageRating} count={reputation.reviewCount} size="md" />
        {reputation.onTimeRate !== null && (
          <span className={styles.ontime}>
            <span className="num">{Math.round(reputation.onTimeRate * 100)}%</span> on-time returns
          </span>
        )}
      </section>
      {hasUnverified && (
        <p className={styles.unverified}>
          <Info aria-hidden />
          <span>
            {u.openDamageReports > 0 && `${u.openDamageReports} damage report${u.openDamageReports === 1 ? "" : "s"}`}
            {u.openDamageReports > 0 && u.openNotReturnedReports > 0 && " and "}
            {u.openNotReturnedReports > 0 && `${u.openNotReturnedReports} non-return report${u.openNotReturnedReports === 1 ? "" : "s"}`} awaiting
            review. These are unverified claims, not established facts.
          </span>
        </p>
      )}
    </div>
  );
}
