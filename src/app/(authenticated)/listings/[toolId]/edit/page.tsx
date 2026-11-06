"use client";

import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState, LoadingState } from "@/components/common/States";
import { PageContainer } from "@/components/layout/AppShell";
import { ToolForm } from "@/features/listings/ToolForm";
import { toDateInput } from "@/lib/format";

export default function EditListingPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const tool = useQuery(api.tools.getForEdit, { toolId: toolId as Id<"tools"> });
  return (
    <PageContainer narrow>
      <PageHeader eyebrow="Lending" title="Edit listing" />
      {tool === undefined ? (
        <LoadingState />
      ) : tool === null ? (
        <EmptyState title="Listing not found" description="It may have been deleted, or it belongs to someone else." />
      ) : (
        <ToolForm
          initial={{
            id: tool.id,
            images: tool.images.filter((i) => i.url).map((i) => ({ storageId: i.storageId, previewUrl: i.url! })),
            values: {
              name: tool.name,
              category: tool.category,
              condition: tool.condition,
              description: tool.description,
              pickupArea: tool.pickupArea,
              pickupLat: tool.pickupLocation?.lat ?? Number.NaN,
              pickupLng: tool.pickupLocation?.lng ?? Number.NaN,
              pickupAddress: tool.pickupAddress,
              instructions: tool.instructions,
              lendingTerms: tool.lendingTerms,
              depositAmount: tool.depositAmount ?? undefined,
              maxLoanDays: tool.maxLoanDays,
              availableFrom: tool.availableFrom ? toDateInput(tool.availableFrom) : "",
              availableUntil: tool.availableUntil ? toDateInput(tool.availableUntil) : "",
            },
          }}
        />
      )}
    </PageContainer>
  );
}
