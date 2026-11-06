"use client";

import clsx from "clsx";
import { CATEGORY_LABELS, CONDITION_LABELS, TOOL_CATEGORIES, TOOL_CONDITIONS, type ToolCategory, type ToolCondition } from "@convex/lib/constants";
import { DEFAULT_FILTERS, RADIUS_OPTIONS, type DiscoveryFilters, type SortKey } from "@/features/discovery/filters";
import styles from "./FiltersPanel.module.scss";

/**
 * The discovery filters. Used in the Filters dialog (map view) and inline in the sidebar (list view).
 * With `counts`, categories show how many tools they hold and empty ones are hidden.
 */
export function FiltersPanel({
  value,
  onChange,
  hasLocation,
  counts,
  total,
  availableCount,
}: {
  value: DiscoveryFilters;
  onChange: (next: DiscoveryFilters) => void;
  hasLocation: boolean;
  counts?: Partial<Record<ToolCategory, number>>;
  total?: number;
  availableCount?: number;
}) {
  const categories = counts ? TOOL_CATEGORIES.filter((c) => (counts[c] ?? 0) > 0 || value.category === c) : TOOL_CATEGORIES;
  const set = <K extends keyof DiscoveryFilters>(key: K, v: DiscoveryFilters[K]) => onChange({ ...value, [key]: v });
  const toggleCondition = (c: ToolCondition) =>
    set("conditions", value.conditions.includes(c) ? value.conditions.filter((x) => x !== c) : [...value.conditions, c]);

  return (
    <div className={styles.panel}>
      <fieldset className={styles.group}>
        <legend>Category</legend>
        <div className={styles.chips}>
          <button
            type="button"
            aria-pressed={value.category === "ALL"}
            className={clsx(styles.chip, value.category === "ALL" && styles.on)}
            onClick={() => set("category", "ALL")}
          >
            All {total !== undefined && <span className={clsx(styles.count, "num")}>{total}</span>}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={value.category === c}
              className={clsx(styles.chip, value.category === c && styles.on)}
              onClick={() => set("category", c)}
            >
              {CATEGORY_LABELS[c]} {counts && <span className={clsx(styles.count, "num")}>{counts[c] ?? 0}</span>}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={!hasLocation}>
        <legend>Distance {!hasLocation && <span className={styles.note}>— set a location first</span>}</legend>
        <div className={styles.segmented}>
          {RADIUS_OPTIONS.map((r) => (
            <button key={String(r)} type="button" className={clsx(value.radiusKm === r && styles.on)} onClick={() => set("radiusKm", r)}>
              {r === "ANY" ? "Any" : `${r} km`}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Condition</legend>
        <div className={styles.chips}>
          {TOOL_CONDITIONS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={value.conditions.includes(c)}
              className={clsx(styles.chip, value.conditions.includes(c) && styles.on)}
              onClick={() => toggleCondition(c)}
            >
              {CONDITION_LABELS[c]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Show</legend>
        <label className={styles.check}>
          <input type="checkbox" checked={value.trustedOnly} onChange={(e) => set("trustedOnly", e.target.checked)} />
          Trusted lenders only
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={value.availableNowOnly} onChange={(e) => set("availableNowOnly", e.target.checked)} />
          Available now only (hide tools with upcoming bookings)
          {availableCount !== undefined && <span className={clsx(styles.count, "num")}>{availableCount}</span>}
        </label>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Sort by</legend>
        <div className={styles.segmented}>
          {(
            [
              ["nearest", "Nearest"],
              ["recent", "Recently listed"],
              ["rating", "Best-rated"],
            ] as [SortKey, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              disabled={k === "nearest" && !hasLocation}
              className={clsx(value.sort === k && styles.on)}
              onClick={() => set("sort", k)}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <button type="button" className={styles.reset} onClick={() => onChange({ ...DEFAULT_FILTERS, sort: hasLocation ? "nearest" : "recent" })}>
        Reset filters
      </button>
    </div>
  );
}
