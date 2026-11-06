/**
 * Pure helpers for the viewer's live location. No browser APIs here, so they
 * are unit-testable and shared by the explore page and the landing page.
 */
import { formatDistance, haversineKm, type LatLng } from "@convex/lib/geo";

export interface Fix {
  point: LatLng;
  /** Reported accuracy radius in metres (null when unknown). */
  accuracy: number | null;
  at: number;
}

/** Ignore GPS jitter: only accept a new fix when it moved, got much more precise, or the old one is stale. */
export const MIN_MOVE_METERS = 20;
const STALE_AFTER_MS = 60_000;

export function metersBetween(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * 1000;
}

export function shouldAcceptFix(prev: Fix | null, next: Fix): boolean {
  if (!prev) return true;
  if (metersBetween(prev.point, next.point) >= MIN_MOVE_METERS) return true;
  if (next.accuracy !== null && (prev.accuracy === null || next.accuracy < prev.accuracy * 0.6)) return true;
  return next.at - prev.at >= STALE_AFTER_MS;
}

/** Distance from the viewer to a listing's approximate (privacy-fuzzed) point. */
export function distanceTo(from: LatLng | null, to: { approxLat: number; approxLng: number }): number | null {
  if (!from) return null;
  return haversineKm(from, { lat: to.approxLat, lng: to.approxLng });
}

/** Recompute `distanceKm` from the viewer's precise position instead of the server's rounded centre. */
export function withLiveDistances<T extends { approxLat: number; approxLng: number; distanceKm: number | null }>(items: T[], from: LatLng | null): T[] {
  if (!from) return items;
  return items.map((i) => ({ ...i, distanceKm: distanceTo(from, i) }));
}

export function sortByDistance<T extends { distanceKm: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
}

/** "850 m" / "1.2 km", or null when there is no location yet. */
export function distanceLabel(km: number | null | undefined): string | null {
  return km === null || km === undefined ? null : formatDistance(km);
}
