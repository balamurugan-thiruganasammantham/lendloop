import Link from "next/link";
import { EmptyState } from "@/components/common/States";

export default function NotFound() {
  return (
    <main style={{ minHeight: "70vh", display: "grid", placeItems: "center" }}>
      <EmptyState
        title="Page not found"
        description="The page you're looking for doesn't exist or has moved."
        action={
          <Link href="/" style={{ textDecoration: "underline" }}>
            Back to LendLoop
          </Link>
        }
      />
    </main>
  );
}
