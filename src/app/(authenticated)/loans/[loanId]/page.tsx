"use client";

import { useParams } from "next/navigation";
import type { Id } from "@convex/_generated/dataModel";
import { LoanDetail } from "@/features/lending/LoanDetail";

export default function LoanPage() {
  const { loanId } = useParams<{ loanId: string }>();
  return <LoanDetail loanId={loanId as Id<"loans">} />;
}
