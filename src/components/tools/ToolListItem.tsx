"use client";

import clsx from "clsx";
import { forwardRef } from "react";
import { CATEGORY_LABELS, CONDITION_LABELS, type ToolCategory, type ToolCondition } from "@convex/lib/constants";
import { formatDistance } from "@convex/lib/geo";
import { Avatar } from "@/components/common/Avatar";
import { SampleTag } from "@/components/common/Badge";
import { Rating } from "@/components/common/Stars";
import { ToolThumb } from "@/components/common/ToolThumb";
import { TrustBadge } from "@/components/common/TrustBadge";
import styles from "./ToolListItem.module.scss";

export interface ToolListItemData {
  id: string;
  name: string;
  category: ToolCategory;
  condition: ToolCondition;
  status: string;
  imageUrl: string | null;
  distanceKm: number | null;
  pickupArea: string;
  isSeed: boolean;
  owner: { name: string; imageUrl: string | null; trustedLender: boolean; averageRating: number | null; reviewCount: number };
}

export const ToolListItem = forwardRef<HTMLButtonElement, { item: ToolListItemData; selected: boolean; onSelect: (id: string) => void }>(
  function ToolListItem({ item, selected, onSelect }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={clsx(styles.item, selected && styles.selected)}
        onClick={() => onSelect(item.id)}
        aria-pressed={selected}
      >
        <ToolThumb src={item.imageUrl} category={item.category} size={64} alt="" />
        <span className={styles.body}>
          <span className={styles.top}>
            <span className={styles.name}>{item.name}</span>
            {item.distanceKm !== null && <span className={clsx(styles.distance, "num")}>{formatDistance(item.distanceKm)}</span>}
          </span>
          <span className={styles.meta}>
            {CATEGORY_LABELS[item.category]} · {CONDITION_LABELS[item.condition]}
            {item.status === "RESERVED" && <span className={styles.reserved}> · Some dates booked</span>}
          </span>
          <span className={styles.owner}>
            <Avatar name={item.owner.name} src={item.owner.imageUrl} size={18} />
            <span className={styles.ownerName}>{item.owner.name}</span>
            {item.owner.trustedLender && <TrustBadge compact />}
            <Rating value={item.owner.averageRating} count={item.owner.reviewCount || undefined} />
            {item.isSeed && <SampleTag />}
          </span>
        </span>
      </button>
    );
  },
);
