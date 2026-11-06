import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";

/** Server-side guard for every authenticated route. */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
