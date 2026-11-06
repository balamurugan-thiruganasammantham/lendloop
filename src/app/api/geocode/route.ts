import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allow, clientIp, TtlCache } from "@/services/serverRateLimit";

/**
 * Place search / reverse geocoding proxy (OpenStreetMap Nominatim by default).
 * Proxying keeps the provider's usage policy (identifying User-Agent, caching,
 * modest request rate) in one place and avoids exposing client IPs to it.
 */
const BASE = process.env.GEOCODER_URL ?? "https://nominatim.openstreetmap.org";
const USER_AGENT = process.env.GEOCODER_USER_AGENT ?? "LendLoop/1.0 (development; set GEOCODER_USER_AGENT)";
const cache = new TtlCache<unknown>(60 * 60 * 1000);

const searchSchema = z.object({ q: z.string().trim().min(2).max(120) });
const reverseSchema = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

interface NominatimPlace {
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  type?: string;
  address?: Record<string, string>;
}

/** Neighbourhood-level and city-level names from a structured address. */
function areaAndCity(address: Record<string, string> | undefined): { area: string | null; city: string | null } {
  if (!address) return { area: null, city: null };
  const area = address.suburb ?? address.neighbourhood ?? address.quarter ?? address.city_district ?? address.village ?? null;
  const city = address.city ?? address.town ?? address.municipality ?? address.county ?? address.state ?? null;
  return { area, city };
}

function shortLabel(display: string): string {
  return display.split(",").slice(0, 3).map((s) => s.trim()).join(", ");
}

export async function GET(request: NextRequest) {
  if (!allow(`geo:${clientIp(request)}`, 30, 60_000)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const params = Object.fromEntries(request.nextUrl.searchParams);
  const isReverse = "lat" in params || "lng" in params;
  let url: string;
  let key: string;
  if (isReverse) {
    const parsed = reverseSchema.safeParse(params);
    if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
    // Reverse lookups only need neighbourhood precision.
    const lat = parsed.data.lat.toFixed(3);
    const lng = parsed.data.lng.toFixed(3);
    key = `r:${lat},${lng}`;
    url = `${BASE}/reverse?format=jsonv2&zoom=14&addressdetails=1&lat=${lat}&lon=${lng}`;
  } else {
    const parsed = searchSchema.safeParse(params);
    if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
    key = `s:${parsed.data.q.toLowerCase()}`;
    url = `${BASE}/search?format=jsonv2&limit=6&q=${encodeURIComponent(parsed.data.q)}`;
  }

  const cached = cache.get(key);
  if (cached) return NextResponse.json(cached, { headers: { "cache-control": "private, max-age=600" } });

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": request.headers.get("accept-language") ?? "en" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Geocoder HTTP ${res.status}`);
    const data = (await res.json()) as NominatimPlace | NominatimPlace[];
    const body = isReverse
      ? Array.isArray(data)
        ? { label: null, area: null, city: null }
        : { label: shortLabel((data as NominatimPlace).display_name ?? "") || null, ...areaAndCity((data as NominatimPlace).address) }
      : {
          results: (data as NominatimPlace[]).map((p) => ({
            label: shortLabel(p.display_name),
            lat: Number(p.lat),
            lng: Number(p.lon),
          })),
        };
    cache.set(key, body);
    return NextResponse.json(body, { headers: { "cache-control": "private, max-age=600" } });
  } catch {
    return NextResponse.json({ error: "geocoder_unavailable" }, { status: 502 });
  }
}
