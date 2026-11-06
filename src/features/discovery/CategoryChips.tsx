"use client";

import clsx from "clsx";
import { CATEGORY_LABELS, TOOL_CATEGORIES, type ToolCategory } from "@convex/lib/constants";
import styles from "./CategoryChips.module.scss";

/** Availability toggle + category filter chips with live counts. */
export function CategoryChips({
  counts,
  total,
  availableCount,
  category,
  onCategory,
  availableOnly,
  onAvailableOnly,
}: {
  counts: Partial<Record<ToolCategory, number>>;
  total: number;
  availableCount: number;
  category: ToolCategory | "ALL";
  onCategory: (c: ToolCategory | "ALL") => void;
  availableOnly: boolean;
  onAvailableOnly: (v: boolean) => void;
}) {
  const visible = TOOL_CATEGORIES.filter((c) => (counts[c] ?? 0) > 0 || c === category);
  return (
    <div className={styles.row} role="toolbar" aria-label="Quick filters">
      <button type="button" aria-pressed={availableOnly} className={clsx(styles.chip, styles.live, availableOnly && styles.on)} onClick={() => onAvailableOnly(!availableOnly)}>
        <span className={styles.dot} aria-hidden /> Available now <span className={clsx(styles.count, "num")}>{availableCount}</span>
      </button>
      <span className={styles.divider} aria-hidden />
      <button type="button" aria-pressed={category === "ALL"} className={clsx(styles.chip, category === "ALL" && styles.on)} onClick={() => onCategory("ALL")}>
        All <span className={clsx(styles.count, "num")}>{total}</span>
      </button>
      {visible.map((c) => (
        <button key={c} type="button" aria-pressed={category === c} className={clsx(styles.chip, category === c && styles.on)} onClick={() => onCategory(category === c ? "ALL" : c)}>
          {CATEGORY_LABELS[c]} <span className={clsx(styles.count, "num")}>{counts[c] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}
