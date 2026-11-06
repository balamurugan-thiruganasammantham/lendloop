"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AuthGate } from "@/features/authentication/AuthGate";
import { AppShell } from "./AppShell";

export function AuthenticatedShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <AuthGate>{pathname === "/onboarding" ? children : <AppShell>{children}</AppShell>}</AuthGate>;
}
