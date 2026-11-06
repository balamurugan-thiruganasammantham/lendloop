import clsx from "clsx";
import {
  Car,
  ChefHat,
  Drill,
  Dumbbell,
  HardHat,
  Package,
  Projector,
  Shovel,
  SprayCan,
  Tent,
  type LucideIcon,
} from "lucide-react";
import type { ToolCategory } from "@convex/lib/constants";
import styles from "./ToolThumb.module.scss";

export const CATEGORY_ICONS: Record<ToolCategory, LucideIcon> = {
  POWER_TOOLS: Drill,
  GARDEN_TOOLS: Shovel,
  KITCHEN_EQUIPMENT: ChefHat,
  CAMPING_EQUIPMENT: Tent,
  CLEANING_EQUIPMENT: SprayCan,
  AUTOMOTIVE_TOOLS: Car,
  ELECTRONICS: Projector,
  CONSTRUCTION_TOOLS: HardHat,
  SPORTS_EQUIPMENT: Dumbbell,
  OTHER: Package,
};

/** Tool photo, or a quiet category glyph when no photo exists (e.g. seed data). */
export function ToolThumb({
  src,
  category,
  size = 56,
  className,
  alt = "",
}: {
  src: string | null | undefined;
  category: ToolCategory;
  size?: number | "fill";
  className?: string;
  alt?: string;
}) {
  const Icon = CATEGORY_ICONS[category];
  const style = size === "fill" ? undefined : { width: size, height: size };
  return (
    <span className={clsx(styles.thumb, size === "fill" && styles.fill, className)} style={style}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Convex storage URLs, sized by CSS
        <img src={src} alt={alt} loading="lazy" />
      ) : (
        <Icon aria-hidden strokeWidth={1.5} />
      )}
    </span>
  );
}
