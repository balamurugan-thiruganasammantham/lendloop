"use client";

import { MapPin } from "lucide-react";
import { useMemo } from "react";
import type { LatLng } from "@convex/lib/geo";
import { FitPoints } from "./camera";
import { RouteLine } from "./layers";
import { MapControls } from "./MapControls";
import { MapMarker } from "./MapMarker";
import MapView from "./MapView";
import styles from "./PickupPin.module.scss";
import { UserDot } from "./UserDot";

/** Exact pickup point (approved participants only) with an optional route from the user. */
export default function RouteMap({
  pickup,
  from,
  fromLabel,
  fromManual,
  path,
}: {
  pickup: LatLng;
  from: LatLng | null;
  /** e.g. "Your location", "Approximate location (±25 km)", or a chosen place. */
  fromLabel?: string;
  fromManual?: boolean;
  path: [number, number][] | null;
}) {
  const points = useMemo<[number, number][]>(
    () =>
      path && path.length > 1
        ? path
        : from
          ? [
              [from.lat, from.lng],
              [pickup.lat, pickup.lng],
            ]
          : [[pickup.lat, pickup.lng]],
    [path, from, pickup],
  );
  return (
    <MapView center={[pickup.lng, pickup.lat]} zoom={15} overlay={<MapControls />}>
      <FitPoints points={points} signature={`${points.length}:${points[0]?.join(",")}`} padding={48} maxZoom={16} />
      {path && path.length > 1 && <RouteLine path={path} />}
      {from && <UserDot lat={from.lat} lng={from.lng} manual={!!fromManual} label={fromLabel ?? null} />}
      <MapMarker lat={pickup.lat} lng={pickup.lng} anchor="bottom" zIndex={10}>
        <span className={styles.pin} aria-label="Pickup point">
          <MapPin aria-hidden />
        </span>
      </MapMarker>
    </MapView>
  );
}
