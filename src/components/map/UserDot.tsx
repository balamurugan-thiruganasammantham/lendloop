"use client";

import clsx from "clsx";
import { MapMarker } from "./MapMarker";
import styles from "./UserDot.module.scss";

/**
 * The viewer's own position: GPS = pulsing blue dot labelled "Your location",
 * a manually chosen place = neutral dot labelled with the place.
 */
export function UserDot({ lat, lng, manual, label }: { lat: number; lng: number; manual: boolean; label?: string | null }) {
  const text = label ?? (manual ? "Selected place" : "Your location");
  return (
    <MapMarker lat={lat} lng={lng} zIndex={12}>
      <span className={styles.wrap} role="img" aria-label={text}>
        <span className={clsx(styles.dot, manual && styles.manual)} />
        <span className={clsx(styles.label, manual && styles.labelManual)}>{text}</span>
      </span>
    </MapMarker>
  );
}
