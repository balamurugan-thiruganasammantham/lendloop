"use client";

import { ArrowRight } from "lucide-react";
import { useMemo } from "react";
import { CATEGORY_LABELS, TOOL_CATEGORIES, type ToolCategory } from "@convex/lib/constants";
import { formatDistance } from "@convex/lib/geo";
import { CATEGORY_ICONS } from "@/components/common/ToolThumb";
import type { DiscoverItem } from "@/components/tools/ToolCard";
import styles from "./CategoryGrid.module.scss";

interface Group {
  category: ToolCategory;
  count: number;
  available: number;
  imageUrl: string | null;
  nearestKm: number | null;
}

/** Group the listed tools by category; biggest groups first (like a region index). */
export function groupByCategory(items: DiscoverItem[]): Group[] {
  const groups = new Map<ToolCategory, Group>();
  for (const item of items) {
    const g = groups.get(item.category) ?? { category: item.category, count: 0, available: 0, imageUrl: null, nearestKm: null };
    g.count += 1;
    if (item.status !== "RESERVED") g.available += 1;
    // Items arrive sorted (nearest first when we know the location), so the first photo is the closest one.
    if (!g.imageUrl && item.imageUrl) g.imageUrl = item.imageUrl;
    if (item.distanceKm !== null && (g.nearestKm === null || item.distanceKm < g.nearestKm)) g.nearestKm = item.distanceKm;
    groups.set(item.category, g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || TOOL_CATEGORIES.indexOf(a.category) - TOOL_CATEGORIES.indexOf(b.category));
}

/**
 * Category index shown at the top of the explore list: large photo cards, one per category,
 * with counts and the nearest distance. Picking one drills into that category.
 */
export function CategoryGrid({ items, onPick }: { items: DiscoverItem[]; onPick: (category: ToolCategory) => void }) {
  const groups = useMemo(() => groupByCategory(items), [items]);
  if (groups.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby="categories-heading">
      <div className={styles.head}>
        <h2 id="categories-heading" className={styles.eyebrow}>
          Categories
        </h2>
        <span className={`${styles.eyebrow} num`}>{groups.length}</span>
      </div>
      <ul className={styles.grid}>
        {groups.map((g) => {
          const Icon = CATEGORY_ICONS[g.category];
          return (
            <li key={g.category}>
              <button type="button" className={styles.card} onClick={() => onPick(g.category)}>
                {g.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL
                  <img className={styles.image} src={g.imageUrl} alt="" loading="lazy" />
                ) : (
                  <span className={styles.placeholder}>
                    <Icon aria-hidden strokeWidth={1.2} />
                  </span>
                )}
                <span className={styles.shade} aria-hidden />
                <span className={`${styles.kicker} num`}>{g.available} available now</span>
                <span className={styles.text}>
                  <span className={`${styles.name} display`}>{CATEGORY_LABELS[g.category]}</span>
                  <span className={styles.meta}>
                    <span className="num">{g.count}</span> {g.count === 1 ? "tool" : "tools"}
                    {g.nearestKm !== null && (
                      <>
                        {" "}
                        · nearest <span className="num">{formatDistance(g.nearestKm)}</span>
                      </>
                    )}
                  </span>
                </span>
                <span className={styles.arrow} aria-hidden>
                  <ArrowRight />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
