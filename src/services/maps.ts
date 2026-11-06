/** Client wrappers for the geocoding and routing proxies (used with TanStack Query). */
import type { LatLng } from "@convex/lib/geo";

export interface PlaceResult {
  label: string;
  lat: number;
  lng: number;
}

export interface RouteResult {
  mode: "walk" | "drive";
  distanceM: number;
  durationS: number;
  path: [number, number][];
  steps: { instruction: string; distanceM: number }[];
}

export class MapServiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const message =
      res.status === 429
        ? "Too many searches — wait a moment."
        : res.status === 404
          ? "No route found between these points."
          : "The map service is unavailable right now.";
    throw new MapServiceError(message, res.status);
  }
  return (await res.json()) as T;
}

export async function searchPlaces(q: string): Promise<PlaceResult[]> {
  const data = await getJson<{ results: PlaceResult[] }>(`/api/geocode?q=${encodeURIComponent(q)}`);
  return data.results;
}

export interface ReverseResult {
  label: string | null;
  area: string | null;
  city: string | null;
}

export async function reverseGeocodeDetails(p: LatLng): Promise<ReverseResult> {
  return getJson<ReverseResult>(`/api/geocode?lat=${p.lat}&lng=${p.lng}`);
}

export async function reverseGeocode(p: LatLng): Promise<string | null> {
  return (await reverseGeocodeDetails(p)).label;
}

export async function fetchRoute(from: LatLng, to: LatLng, mode: "walk" | "drive"): Promise<RouteResult> {
  const f = `${from.lat.toFixed(5)},${from.lng.toFixed(5)}`;
  const t = `${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
  return getJson<RouteResult>(`/api/directions?from=${f}&to=${t}&mode=${mode}`);
}
