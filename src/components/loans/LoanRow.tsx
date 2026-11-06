import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { LoanStatus, ToolCategory } from "@convex/lib/constants";
import { Avatar } from "@/components/common/Avatar";
import { Badge, LoanStatusBadge } from "@/components/common/Badge";
import { ToolThumb } from "@/components/common/ToolThumb";
import { formatRange, relativeTime } from "@/lib/format";
import styles from "@/styles/pages/lists.module.scss";

export interface LoanRowData {
  id: string;
  role: "BORROWER" | "OWNER";
  status: LoanStatus;
  pickupAt: number;
  returnBy: number;
  updatedAt: number;
  lateReturn: boolean | null;
  disputeOutcome: string | null;
  feedbackGiven: boolean;
  tool: { name: string; category: ToolCategory; imageUrl: string | null };
  counterpart: { name: string; imageUrl: string | null } | null;
}

export function LoanRow({ loan, cta }: { loan: LoanRowData; cta?: string }) {
  return (
    <li className={styles.row}>
      <Link href={`/loans/${loan.id}`} className={styles.rowLink}>
        <ToolThumb src={loan.tool.imageUrl} category={loan.tool.category} size={56} />
        <div className={styles.main}>
          <div className={styles.titleLine}>
            <h2 className={styles.title}>{loan.tool.name}</h2>
            <LoanStatusBadge status={loan.status} />
            <Badge tone="neutral">{loan.role === "BORROWER" ? "Borrowing" : "Lending"}</Badge>
            {loan.lateReturn && <Badge tone="warn">Late</Badge>}
            {loan.disputeOutcome && <Badge tone="danger">Resolved: {loan.disputeOutcome.replace("_", " ").toLowerCase()}</Badge>}
          </div>
          {loan.counterpart && (
            <p className={styles.meta}>
              <Avatar name={loan.counterpart.name} src={loan.counterpart.imageUrl} size={16} /> {loan.role === "BORROWER" ? "from" : "to"}{" "}
              <span className={styles.strong}>{loan.counterpart.name}</span> · {formatRange(loan.pickupAt, loan.returnBy)}
            </p>
          )}
        </div>
      </Link>
      <div className={styles.right}>
        <span className={styles.time}>Updated {relativeTime(loan.updatedAt)}</span>
        {cta && (
          <Link href={`/loans/${loan.id}`} className={styles.secondaryLink}>
            {cta} <ArrowRight />
          </Link>
        )}
      </div>
    </li>
  );
}
