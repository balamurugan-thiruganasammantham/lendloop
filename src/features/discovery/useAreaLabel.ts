"use client";

import { useQuery } from "@tanstack/react-query";
import { reverseGeocodeDetails } from "@/services/maps";
import type { LocationState } from "./LocationProvider";

/** Neighbourhood + city for the panel heading (reverse-geocoded at ~1 km precision for GPS). */
export function useAreaLabel(state: LocationState): { area: string | null; city: string | null } {
  const gpsPoint = state.status === "ready" && state.source === "gps" ? state.point : null;
  const rounded = gpsPoint ? { lat: Math.round(gpsPoint.lat * 100) / 100, lng: Math.round(gpsPoint.lng * 100) / 100 } : null;
  const reverse = useQuery({
    queryKey: ["reverse", rounded?.lat, rounded?.lng],
    queryFn: () => reverseGeocodeDetails(rounded!),
    enabled: rounded !== null,
    staleTime: 60 * 60_000,
  });
  if (state.status !== "ready") return { area: null, city: null };
  if (state.source === "gps") return { area: reverse.data?.area ?? null, city: reverse.data?.city ?? null };
  // Manual places come from search: "Indiranagar, Bengaluru, Karnataka".
  const parts = (state.label ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return { area: parts[0] ?? null, city: parts[1] ?? null };
}
