"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingState } from "@/components/common/States";
import { Tabs } from "@/components/common/Tabs";
import { PageContainer } from "@/components/layout/AppShell";
import { AdminAudit, AdminAutomation, AdminDamage, AdminDisputes, AdminLoans, AdminOverview, AdminReports, AdminTools, AdminUsers } from "@/features/admin/AdminSections";
import { useViewer } from "@/features/authentication/ViewerContext";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "listings", label: "Listings" },
  { key: "loans", label: "Loans" },
  { key: "disputes", label: "Disputes" },
  { key: "damage", label: "Damage" },
  { key: "reports", label: "Reported feedback" },
  { key: "automation", label: "Automation" },
  { key: "audit", label: "Audit log" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function Admin() {
  const viewer = useViewer();
  const params = useSearchParams();
  const router = useRouter();
  const tab = (TABS.find((t) => t.key === params.get("tab"))?.key ?? "overview") as TabKey;
  // UI hint only — every admin query/mutation re-checks the role on the server.
  if (viewer.role !== "ADMIN") {
    return (
      <PageContainer>
        <EmptyState title="Administrators only" description="You don't have access to this area." />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      <PageHeader eyebrow="Administration" title="Admin" description="Every action here is recorded in the audit log." />
      <Tabs label="Admin sections" items={TABS} value={tab} onChange={(k) => router.replace(`/admin?tab=${k}`, { scroll: false })} />
      <div className="admin-body">
        {tab === "overview" && <AdminOverview onNavigate={(k) => router.replace(`/admin?tab=${k}`)} />}
        {tab === "users" && <AdminUsers />}
        {tab === "listings" && <AdminTools />}
        {tab === "loans" && <AdminLoans />}
        {tab === "disputes" && <AdminDisputes />}
        {tab === "damage" && <AdminDamage />}
        {tab === "reports" && <AdminReports />}
        {tab === "automation" && <AdminAutomation />}
        {tab === "audit" && <AdminAudit />}
      </div>
    </PageContainer>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Admin />
    </Suspense>
  );
}
