"use client";

import clsx from "clsx";
import { LayoutGrid, Map as MapIcon } from "lucide-react";
import styles from "./ViewToggle.module.scss";

export type ExploreViewMode = "map" | "list";

/** Map / List switch for the explore page (list = cards grid instead of the map). */
export function ViewToggle({ value, onChange, compact }: { value: ExploreViewMode; onChange: (v: ExploreViewMode) => void; compact?: boolean }) {
  return (
    <div className={clsx(styles.toggle, compact && styles.compact)} role="group" aria-label="View">
      <button type="button" aria-pressed={value === "map"} className={clsx(value === "map" && styles.on)} onClick={() => onChange("map")} title="Map view">
        <MapIcon aria-hidden />
        <span>Map</span>
      </button>
      <button type="button" aria-pressed={value === "list"} className={clsx(value === "list" && styles.on)} onClick={() => onChange("list")} title="List view">
        <LayoutGrid aria-hidden />
        <span>List</span>
      </button>
    </div>
  );
}
