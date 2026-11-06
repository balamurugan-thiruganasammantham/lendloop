"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/common/States";

export default function GlobalRouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error(error);
  }, [error]);
  return (
    <main style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
      <ErrorState
        title="This page couldn't load"
        message="An unexpected error occurred. Your data is safe — try again, or go back to the map."
        onRetry={reset}
      />
    </main>
  );
}
