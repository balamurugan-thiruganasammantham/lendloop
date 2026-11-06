import type { Metadata } from "next";
import { Landing } from "@/components/landing/Landing";

export const metadata: Metadata = {
  title: "LendLoop — Borrow what you need. Lend what you don't.",
};

export default function HomePage() {
  return <Landing />;
}
