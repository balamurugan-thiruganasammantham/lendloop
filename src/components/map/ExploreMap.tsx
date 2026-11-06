"use client";

import { useMemo, type ReactNode } from "react";
import { SEED_NEIGHBORHOOD, type ToolCategory } from "@convex/lib/constants";
import { formatDistance, type LatLng } from "@convex/lib/geo";
import { FitPoints, FlyTo } from "./camera";
import { AccuracyCircle, RadiusRing } from "./layers";
import { MapControls } from "./MapControls";
import MapView from "./MapView";
import { regionOf, ToolPins, type PinItem } from "./ToolPins";
import { UserDot } from "./UserDot";

export interface ExploreMapTool {
  id: string;
  name: string;
  pickupArea: string;
  category: ToolCategory;
  approxLat: number;
  approxLng: number;
  imageUrl: string | null;
  distanceKm: number | null;
  status: string;
  owner: { trustedLender: boolean };
}

export interface ExploreMapProps {
  tools: ExploreMapTool[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  me: {
    point: LatLng;
    source: "gps" | "manual";
    accuracy: number | null;
    label: string | null;
  } | null;
  radiusKm: number | null;
  onLocate: () => void;
  locating: boolean;
  /** Incremented to fly back to the user's position. */
  recenterKey: number;
  /** Pixels hidden at the bottom (carousel / mobile sheet). */
  bottomInset: number;
  overlay?: ReactNode;
}

export default function ExploreMap(props: ExploreMapProps) {
  const { tools, selectedId, hoveredId, onSelect, onHover, me, radiusKm, onLocate, locating, recenterKey, bottomInset, overlay } = props;
  const pins: PinItem[] = useMemo(
    () =>
      tools.map((t) => ({
        id: t.id,
        name: t.name,
        region: regionOf(t.pickupArea),
        category: t.category,
        lat: t.approxLat,
        lng: t.approxLng,
        imageUrl: t.imageUrl,
        availability: t.status === "RESERVED" ? "reserved" : "available",
        trusted: t.owner.trustedLender,
        meta: t.distanceKm !== null ? `about ${formatDistance(t.distanceKm)} away` : undefined,
        distance: t.distanceKm !== null ? formatDistance(t.distanceKm) : null,
      })),
    [tools],
  );
  const selected = pins.find((p) => p.id === selectedId) ?? null;
  // Nothing nearby (e.g. you're in Puducherry and the tools are in Bengaluru): frame you together
  // with the closest tools instead of zooming into an empty map around you.
  const NEARBY_KM = 25;
  const far = useMemo(() => {
    if (!me || tools.length === 0) return false;
    return !tools.some((t) => t.distanceKm !== null && t.distanceKm <= NEARBY_KM);
  }, [me, tools]);
  const points = useMemo(() => {
    if (!me) return pins.map((p) => [p.lat, p.lng] as [number, number]);
    if (!far) return [];
    const nearest = [...tools]
      .filter((t) => t.distanceKm !== null)
      .sort((a, b) => a.distanceKm! - b.distanceKm!)
      .slice(0, 3)
      .map((t) => [t.approxLat, t.approxLng] as [number, number]);
    return [[me.point.lat, me.point.lng] as [number, number], ...nearest];
  }, [me, far, pins, tools]);
  const start: [number, number] = me ? [me.point.lng, me.point.lat] : [SEED_NEIGHBORHOOD.lng, SEED_NEIGHBORHOOD.lat];
  const padding = useMemo(() => ({ bottom: bottomInset }), [bottomInset]);
  // Fly to the viewer on the first fix, a newly picked place or a "locate" press, not on every live GPS update.
  const meKey = me ? `${me.source === "manual" ? `${me.point.lat},${me.point.lng}` : "gps"}:${recenterKey}` : null;

  return (
    <MapView
      center={start}
      zoom={me ? 13.6 : 12.8}
      overlay={
        <>
          {overlay}
          <MapControls onLocate={onLocate} locating={locating} />
        </>
      }
    >
      {me && radiusKm !== null && <RadiusRing center={me.point} radiusKm={radiusKm} />}
      {me && me.accuracy !== null && me.accuracy < 1500 && <AccuracyCircle center={me.point} meters={me.accuracy} />}
      {me && (
        <UserDot
          lat={me.point.lat}
          lng={me.point.lng}
          manual={me.source === "manual"}
          label={me.source === "manual" ? (me.label?.split(",")[0] ?? null) : null}
        />
      )}
      {me && meKey && !far && <FlyTo target={{ lat: me.point.lat, lng: me.point.lng, key: meKey }} zoom={13.6} padding={padding} />}
      <FitPoints
        points={points}
        signature={`${far ? `far:${meKey}` : "all"}:${points.length}`}
        padding={{ top: 80, bottom: bottomInset + 40, left: 60, right: 60 }}
      />
      <ToolPins items={pins} selectedId={selectedId} hoveredId={hoveredId} onSelect={onSelect} onHover={onHover} />
      <FlyTo target={selected ? { lat: selected.lat, lng: selected.lng, key: selected.id } : null} zoom={15.2} padding={padding} />
    </MapView>
  );
}
