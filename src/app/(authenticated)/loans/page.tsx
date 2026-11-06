"use client";

import { useQuery } from "convex/react";
import { LayoutGrid } from "lucide-react";
import Link from "next/link";
import { api } from "@convex/_generated/api";
import type { LoanStatus } from "@convex/lib/constants";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingState } from "@/components/common/States";
import { PageContainer } from "@/components/layout/AppShell";
import { LoanRow } from "@/components/loans/LoanRow";
import styles from "@/styles/pages/lists.module.scss";

function nextStep(role: "BORROWER" | "OWNER", status: LoanStatus): string | undefined {
  if (role === "BORROWER") {
    if (status === "APPROVED" || status === "COLLECTION_OTP_PENDING") return "Pickup code";
    if (status === "ACTIVE_LOAN" || status === "OVERDUE") return "Return item";
    if (status === "RETURN_VERIFICATION_PENDING") return "Return code";
    if (status === "DAMAGE_REPORTED") return "Respond";
  } else {
    if (status === "APPROVED" || status === "COLLECTION_OTP_PENDING") return "Verify pickup";
    if (status === "RETURN_REQUESTED") return "Review return";
    if (status === "RETURN_VERIFICATION_PENDING") return "Verify return";
  }
  return undefined;
}

export default function ActiveLoansPage() {
  const loans = useQuery(api.loans.listActive, {});
  const borrowing = loans?.filter((l) => l.role === "BORROWER") ?? [];
  const lending = loans?.filter((l) => l.role === "OWNER") ?? [];
  return (
    <PageContainer>
      <PageHeader eyebrow="In progress" title="Active Loans" description="Everything approved, in use, or being returned — as borrower and as lender." />
      {loans === undefined ? (
        <LoadingState rows={3} />
      ) : loans.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid />}
          title="No active loans"
          description="Approved requests and tools in use will show up here."
          action={
            <Link href="/explore" className={styles.secondaryLink}>
              Explore tools
            </Link>
          }
        />
      ) : (
        <>
          {[
            ["Borrowing", borrowing],
            ["Lending", lending],
          ].map(([label, rows]) =>
            (rows as typeof loans).length ? (
              <section key={label as string} className={styles.section}>
                <h2 className={styles.sectionLabel}>{label as string}</h2>
                <ul className={styles.list}>
                  {(rows as typeof loans).map((l) => (
                    <LoanRow key={l.id} loan={{ ...l, tool: { ...l.tool, imageUrl: l.tool.imageUrl ?? null } }} cta={nextStep(l.role, l.status)} />
                  ))}
                </ul>
              </section>
            ) : null,
          )}
        </>
      )}
    </PageContainer>
  );
}
