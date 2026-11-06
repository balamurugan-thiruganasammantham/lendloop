"use client";

import { PageHeader } from "@/components/common/PageHeader";
import { PageContainer } from "@/components/layout/AppShell";
import { ToolForm } from "@/features/listings/ToolForm";

export default function NewListingPage() {
  return (
    <PageContainer narrow>
      <PageHeader eyebrow="Lending" title="List a tool" description="It appears on the map as soon as you publish. You approve every request." />
      <ToolForm />
    </PageContainer>
  );
}
