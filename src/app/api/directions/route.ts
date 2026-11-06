import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allow, TtlCache } from "@/services/serverRateLimit";

/**
 * Route between two points (OSRM). Requires a signed-in user because the
 * destination is a precise pickup location. Coordinates are not logged.
 */
const WALK_BASE = process.env.ROUTING_WALK_URL ?? "https://routing.openstreetmap.de/routed-foot";
const DRIVE_BASE = process.env.ROUTING_DRIVE_URL ?? "https://router.project-osrm.org";
const cache = new TtlCache<unknown>(15 * 60 * 1000, 200);

const coord = z
  .string()
  .regex(/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/)
  .transform((s) => s.split(",").map(Number) as [number, number])
  .refine(([lat, lng]) => Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
const schema = z.object({ from: coord, to: coord, mode: z.enum(["walk", "drive"]).default("walk") });

interface OsrmStep {
  distance: number;
  name: string;
  maneuver: { type: string; modifier?: string };
}
interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: { steps: OsrmStep[] }[];
}

function describe(step: OsrmStep): string {
  const road = step.name ? ` onto ${step.name}` : "";
  const mod = step.maneuver.modifier ? ` ${step.maneuver.modifier}` : "";
  switch (step.maneuver.type) {
    case "depart":
      return `Head out${step.name ? ` on ${step.name}` : ""}`;
    case "arrive":
      return "Arrive at the pickup point";
    case "turn":
    case "end of road":
      return `Turn${mod}${road}`;
    case "roundabout":
    case "rotary":
      return `Take the roundabout${road}`;
    case "fork":
      return `Keep${mod}${road}`;
    default:
      return `Continue${mod}${road}`;
  }
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!allow(`route:${userId}`, 20, 60_000)) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const parsed = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  const { from, to, mode } = parsed.data;
  const key = `${mode}:${from.join(",")}:${to.join(",")}`;
  const cached = cache.get(key);
  if (cached) return NextResponse.json(cached, { headers: { "cache-control": "private, no-store" } });

  const base = mode === "walk" ? WALK_BASE : DRIVE_BASE;
  const profile = mode === "walk" ? "foot" : "driving";
  const url = `${base}/route/v1/${profile}/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "LendLoop/1.0" } });
    if (!res.ok) throw new Error(`Router HTTP ${res.status}`);
    const data = (await res.json()) as { code: string; routes?: OsrmRoute[] };
    const route = data.routes?.[0];
    if (data.code !== "Ok" || !route) return NextResponse.json({ error: "no_route" }, { status: 404 });
    const body = {
      mode,
      distanceM: Math.round(route.distance),
      durationS: Math.round(route.duration),
      path: route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]),
      steps: route.legs
        .flatMap((l) => l.steps)
        .filter((s) => s.distance > 0 || s.maneuver.type === "arrive")
        .slice(0, 40)
        .map((s) => ({ instruction: describe(s), distanceM: Math.round(s.distance) })),
    };
    cache.set(key, body);
    return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "routing_unavailable" }, { status: 502 });
  }
}
