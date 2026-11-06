"use client";

import clsx from "clsx";
import type { FunctionReturnType } from "convex/server";
import { BadgeCheck, MapPin } from "lucide-react";
import { forwardRef } from "react";
import type { api } from "@convex/_generated/api";
import { CATEGORY_LABELS, CONDITION_LABELS } from "@convex/lib/constants";
import { formatDistance } from "@convex/lib/geo";
import { Avatar } from "@/components/common/Avatar";
import { CATEGORY_ICONS } from "@/components/common/ToolThumb";
import { LocationCta } from "@/features/discovery/LocationCta";
import { formatMoney } from "@/lib/format";
import styles from "./ToolCard.module.scss";

export type DiscoverItem = FunctionReturnType<typeof api.tools.discover>["items"][number];

interface Props {
  item: DiscoverItem;
  selected?: boolean;
  hovered?: boolean;
  onSelect: (id: string) => void;
  onHover?: (id: string | null) => void;
}

/** Premium listing card used in the explore panel. */
export const ToolCard = forwardRef<HTMLButtonElement, Props>(function ToolCard({ item, selected, hovered, onSelect, onHover }, ref) {
  const Icon = CATEGORY_ICONS[item.category];
  const reserved = item.status === "RESERVED";
  const trusted = item.owner.trustedLender;
  return (
    // The location button is a sibling of the card button (buttons can't be nested).
    <div className={styles.wrap}>
      <button
        ref={ref}
        type="button"
        className={clsx(styles.card, trusted && styles.featured, selected && styles.selected, hovered && styles.hovered)}
        onClick={() => onSelect(item.id)}
        onMouseEnter={() => onHover?.(item.id)}
        onMouseLeave={() => onHover?.(null)}
        aria-pressed={selected}
      >
        <span className={styles.media}>
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL
            <img src={item.imageUrl} alt="" loading="lazy" />
          ) : (
            <span className={styles.placeholder}>
              <Icon aria-hidden strokeWidth={1.3} />
            </span>
          )}
          <span className={clsx(styles.status, reserved && styles.statusReserved)}>
            <span aria-hidden className={styles.statusDot} />
            {reserved ? "Some dates booked" : "Available now"}
          </span>
          {item.distanceKm !== null && (
            <span className={clsx(styles.distance, "num")} title="Distance to the approximate pickup area">
              {formatDistance(item.distanceKm)}
            </span>
          )}
        </span>

        <span className={styles.body}>
          <span className={styles.titleRow}>
            <span className={clsx(styles.name, "display")}>{item.name}</span>
            {item.owner.averageRating !== null && (
              <span className={styles.rating} aria-label={`Lender rated ${item.owner.averageRating}`}>
                ★ <span className="num">{item.owner.averageRating.toFixed(1)}</span>
              </span>
            )}
          </span>
          <span className={styles.meta}>
            {CATEGORY_LABELS[item.category]} · {CONDITION_LABELS[item.condition]}
          </span>
          <span className={styles.owner}>
            <Avatar name={item.owner.name} src={item.owner.imageUrl} size={20} />
            <span className={styles.ownerName}>{item.owner.name}</span>
            {trusted && (
              <span className={styles.trusted}>
                <BadgeCheck aria-hidden /> Trusted
              </span>
            )}
            <span className={styles.area}>
              <MapPin aria-hidden /> {item.pickupArea.split(",")[0]}
            </span>
          </span>
          <span className={styles.excerpt}>{item.excerpt}</span>
          <span className={styles.tags}>
            {item.isMine && <span className={clsx(styles.tag, styles.tagMine)}>Your listing</span>}
            {trusted && <span className={clsx(styles.tag, styles.tagGold)}>Trusted lender</span>}
            <span className={styles.tag}>
              Up to {item.maxLoanDays} day{item.maxLoanDays === 1 ? "" : "s"}
            </span>
            {item.depositAmount !== null && <span className={styles.tag}>₹{formatMoney(item.depositAmount)} deposit</span>}
            {item.isSeed && <span className={clsx(styles.tag, styles.tagSample)}>Sample</span>}
          </span>
        </span>
      </button>
      {item.distanceKm === null && <LocationCta className={styles.locate} />}
    </div>
  );
});
