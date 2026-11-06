"use client";

import { MapPin } from "lucide-react";
import { useEffect } from "react";
import { SEED_NEIGHBORHOOD } from "@convex/lib/constants";
import type { LatLng } from "@convex/lib/geo";
import { FlyTo } from "./camera";
import { MapControls } from "./MapControls";
import { MapMarker } from "./MapMarker";
import MapView, { useMapContext } from "./MapView";
import styles from "./PickupPin.module.scss";

function ClickToPlace({ onPick }: { onPick: (p: LatLng) => void }) {
  const { map } = useMapContext();
  useEffect(() => {
    const handler = (e: { lngLat: { lat: number; lng: number } }) => onPick({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    map.on("click", handler);
    map.getCanvas().style.cursor = "crosshair";
    return () => {
      map.off("click", handler);
    };
  }, [map, onPick]);
  return null;
}

/** Owner picks the exact (private) pickup point by clicking or dragging the pin. */
export default function LocationPickerMap({ value, onChange, fallback }: { value: LatLng | null; onChange: (p: LatLng) => void; fallback: LatLng | null }) {
  const start = value ?? fallback ?? { lat: SEED_NEIGHBORHOOD.lat, lng: SEED_NEIGHBORHOOD.lng };
  return (
    <MapView center={[start.lng, start.lat]} zoom={value ? 16 : 14} overlay={<MapControls />}>
      <ClickToPlace onPick={onChange} />
      {value && (
        <>
          <FlyTo target={{ lat: value.lat, lng: value.lng, key: `${value.lat.toFixed(5)},${value.lng.toFixed(5)}` }} zoom={16} />
          <MapMarker lat={value.lat} lng={value.lng} anchor="bottom" draggable onDragEnd={(p) => onChange({ lat: p.lat, lng: p.lng })} zIndex={10}>
            <span className={styles.pin} aria-label="Pickup point">
              <MapPin aria-hidden />
            </span>
          </MapMarker>
        </>
      )}
      {!value && fallback && <FlyTo target={{ lat: fallback.lat, lng: fallback.lng, key: "fallback" }} zoom={15} />}
    </MapView>
  );
}
