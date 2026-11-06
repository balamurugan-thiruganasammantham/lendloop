"use client";

import { useQuery } from "convex/react";
import { History } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingState } from "@/components/common/States";
import { Tabs } from "@/components/common/Tabs";
import { PageContainer } from "@/components/layout/AppShell";
import { LoanRow } from "@/components/loans/LoanRow";
import styles from "@/styles/pages/lists.module.scss";

type Filter = "ALL" | "BORROWER" | "OWNER";

export default function HistoryPage() {
  const loans = useQuery(api.loans.history, {});
  const [filter, setFilter] = useState<Filter>("ALL");
  const rows = (loans ?? []).filter((l) => filter === "ALL" || l.role === filter);
  return (
    <PageContainer>
      <PageHeader eyebrow="Record" title="History" description="Completed and cancelled loans. This is the verified record your reputation is built on." />
      <Tabs
        label="Role"
        value={filter}
        onChange={setFilter}
        items={[
          { key: "ALL", label: "All", count: loans?.length },
          { key: "BORROWER", label: "Borrowed", count: loans?.filter((l) => l.role === "BORROWER").length },
          { key: "OWNER", label: "Lent", count: loans?.filter((l) => l.role === "OWNER").length },
        ]}
      />
      {loans === undefined ? (
        <LoadingState rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<History />} title="Nothing here yet" description="Finished loans appear here with any feedback you've given." />
      ) : (
        <ul className={styles.list}>
          {rows.map((l) => (
            <LoanRow
              key={l.id}
              loan={{ ...l, tool: { ...l.tool, imageUrl: l.tool.imageUrl ?? null } }}
              cta={l.status === "COMPLETED" && !l.feedbackGiven ? "Leave feedback" : undefined}
            />
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
