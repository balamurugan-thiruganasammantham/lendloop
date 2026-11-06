/**
 * Geographic helpers. Pure functions shared by backend and frontend.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_DEG_LAT = 111.32;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function isValidLatLng(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180
  );
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Human readable distance: "350 m", "1.2 km", "14 km". */
export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "—";
  if (km < 1) {
    const meters = Math.max(50, Math.round((km * 1000) / 50) * 50);
    return meters >= 1000 ? "1 km" : `${meters} m`;
  }
  if (km < 10) return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** Axis-aligned box that fully contains the circle of `radiusKm` around `center`. */
export function boundingBox(center: LatLng, radiusKm: number): BoundingBox {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const cosLat = Math.max(0.01, Math.cos(toRad(center.lat)));
  const dLng = radiusKm / (KM_PER_DEG_LAT * cosLat);
  return {
    minLat: Math.max(-90, center.lat - dLat),
    maxLat: Math.min(90, center.lat + dLat),
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

export function inBox(p: LatLng, box: BoundingBox): boolean {
  if (p.lat < box.minLat || p.lat > box.maxLat) return false;
  // Handle boxes that cross the antimeridian.
  if (box.minLng < -180) return p.lng >= box.minLng + 360 || p.lng <= box.maxLng;
  if (box.maxLng > 180) return p.lng >= box.minLng || p.lng <= box.maxLng - 360;
  return p.lng >= box.minLng && p.lng <= box.maxLng;
}

/** Grid cell size used for public location fuzzing (~440 m north-south). */
export const APPROX_CELL_DEG = 0.004;

/**
 * Produce a public, approximate coordinate for a private pickup location.
 *
 * The exact point is snapped to the centre of a ~440 m grid cell and then
 * offset by a random amount within ±35% of the cell so that markers from the
 * same cell do not stack. The result is always within roughly 600 m of the
 * true location but never reveals it. `random` is injectable for tests.
 */
export function approximateLocation(exact: LatLng, random: () => number = Math.random): LatLng {
  const cellLat = APPROX_CELL_DEG;
  const centerLat = (Math.floor(exact.lat / cellLat) + 0.5) * cellLat;
  // Longitude cell width depends only on the latitude band, keeping the grid stable.
  const cellLng = APPROX_CELL_DEG / Math.max(0.01, Math.cos(toRad(centerLat)));
  const centerLng = (Math.floor(exact.lng / cellLng) + 0.5) * cellLng;
  const jitter = () => (random() - 0.5) * 0.7;
  return {
    lat: round(centerLat + jitter() * cellLat, 5),
    lng: round(centerLng + jitter() * cellLng, 5),
  };
}

/** Round coordinates to `decimals` places (2 decimals ≈ 1.1 km). */
export function coarsen(p: LatLng, decimals = 2): LatLng {
  return { lat: round(p.lat, decimals), lng: round(p.lng, decimals) };
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
