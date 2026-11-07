"use client";

import { useMemo } from "react";
import type { ToolCategory } from "@convex/lib/constants";
import type { LatLng } from "@convex/lib/geo";
import { FitPoints, FlyTo } from "@/components/map/camera";
import { MapControls } from "@/components/map/MapControls";
import MapView from "@/components/map/MapView";
import { regionOf, ToolPins, type PinItem } from "@/components/map/ToolPins";
import { UserDot } from "@/components/map/UserDot";
import { describePosition, distanceLabel } from "@/lib/location";

export interface PublicTool {
  id: string;
  name: string;
  pickupArea: string;
  category: ToolCategory;
  approxLat: number;
  approxLng: number;
  imageUrl: string | null;
  availableNow: boolean;
  distanceKm: number | null;
}

interface Props {
  tools: PublicTool[];
  selectedId: string | null;
  hoveredId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  me: { point: LatLng; manual: boolean; label: string | null; accuracy: number | null } | null;
  onLocate: () => void;
  locating: boolean;
  /** Incremented by the locate button to fly to the visitor. */
  recenterKey: number;
}

export default function PublicMap({ tools, selectedId, hoveredId, onSelect, onHover, me, onLocate, locating, recenterKey }: Props) {
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
        availability: t.availableNow ? "available" : "reserved",
        distance: distanceLabel(t.distanceKm),
      })),
    [tools],
  );
  const points = useMemo(() => pins.map((p) => [p.lat, p.lng] as [number, number]), [pins]);
  const selected = pins.find((p) => p.id === selectedId);
  const center: [number, number] = points[0] ? [points[0][1], points[0][0]] : [77.6412, 12.9719];
  // Only the locate button moves the camera to the visitor; the intro still frames the tools.
  const meTarget = me && recenterKey > 0 ? { lat: me.point.lat, lng: me.point.lng, key: `me:${recenterKey}` } : null;
  return (
    <MapView center={center} zoom={1.8} overlay={<MapControls onLocate={onLocate} locating={locating} />}>
      {/* Globe → neighbourhood intro, like a map product opening up. */}
      <FitPoints points={points} signature={String(points.length)} padding={{ top: 70, bottom: 70, left: 70, right: 90 }} maxZoom={14.2} duration={3200} />
      <FlyTo target={selected ? { lat: selected.lat, lng: selected.lng, key: selected.id } : null} zoom={15.2} />
      <FlyTo target={meTarget} zoom={13.6} />
      {me && (
        <UserDot
          lat={me.point.lat}
          lng={me.point.lng}
          manual={me.manual}
          label={describePosition({ source: me.manual ? "manual" : "gps", label: me.label, accuracy: me.accuracy }).label}
        />
      )}
      <ToolPins items={pins} selectedId={selectedId} hoveredId={hoveredId} onSelect={onSelect} onHover={onHover} />
    </MapView>
  );
}
