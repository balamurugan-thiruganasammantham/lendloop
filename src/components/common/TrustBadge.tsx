import { ShieldCheck } from "lucide-react";
import styles from "./TrustBadge.module.scss";

export function TrustBadge({ compact }: { compact?: boolean }) {
  return (
    <span className={styles.trust} title="Marked as a Trusted Lender by LendLoop administrators">
      <ShieldCheck aria-hidden />
      {compact ? <span className="visually-hidden">Trusted lender</span> : "Trusted lender"}
    </span>
  );
}
