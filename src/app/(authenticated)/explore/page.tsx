"use client";

import { Suspense } from "react";
import { LoadingState } from "@/components/common/States";
import { ExploreView } from "@/features/discovery/ExploreView";

export default function ExplorePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading map…" />}>
      <ExploreView />
    </Suspense>
  );
}
