"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import { formatDistance } from "@convex/lib/geo";
import { CATEGORY_ICONS } from "@/components/common/ToolThumb";
import type { DiscoverItem } from "@/components/tools/ToolCard";
import { LocationCta } from "./LocationCta";
import styles from "./MapCarousel.module.scss";

/** Horizontal strip of compact cards over the map, like a featured rail. */
export function MapCarousel({
  items,
  selectedId,
  onSelect,
  onHover,
}: {
  items: DiscoverItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (selectedId)
      refs.current.get(selectedId)?.scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: "smooth",
      });
  }, [selectedId]);
  if (items.length === 0) return null;
  return (
    <div className={styles.rail} role="list" aria-label="Tools on the map">
      {items.slice(0, 16).map((item) => {
        const Icon = CATEGORY_ICONS[item.category];
        const hasDistance = item.distanceKm !== null;
        return (
          <div key={item.id} role="listitem" className={styles.item}>
            <button
              ref={(el) => {
                if (el) refs.current.set(item.id, el);
                else refs.current.delete(item.id);
              }}
              type="button"
              className={clsx(
                styles.card,
                item.id === selectedId && styles.selected,
                item.owner.trustedLender && styles.trusted,
                !hasDistance && styles.cardWithCta,
              )}
              onClick={() => onSelect(item.id)}
              onMouseEnter={() => onHover(item.id)}
              onMouseLeave={() => onHover(null)}
            >
              <span className={styles.thumb}>
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL
                  <img src={item.imageUrl} alt="" loading="lazy" />
                ) : (
                  <Icon aria-hidden strokeWidth={1.5} />
                )}
                <span className={clsx(styles.dot, item.status === "RESERVED" && styles.dotReserved)} aria-hidden />
              </span>
              <span className={styles.text}>
                <span className={clsx(styles.name, "display")}>{item.name}</span>
                <span className={styles.meta}>{item.pickupArea.split(",")[0]}</span>
              </span>
              {item.distanceKm !== null && <span className={clsx(styles.pill, "num")}>{formatDistance(item.distanceKm)}</span>}
            </button>
            {!hasDistance && <LocationCta className={styles.locate} />}
          </div>
        );
      })}
    </div>
  );
}
