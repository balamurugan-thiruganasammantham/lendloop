import type { ToolCategory, ToolCondition } from "@convex/lib/constants";

export type SortKey = "nearest" | "recent" | "rating";

export interface DiscoveryFilters {
  category: ToolCategory | "ALL";
  radiusKm: number | "ANY";
  conditions: ToolCondition[];
  trustedOnly: boolean;
  availableNowOnly: boolean;
  sort: SortKey;
}

/**
 * One filter state shared by the category chips above the list and the Filters dialog.
 * Distance defaults to "Any": everything is listed, nearest first, so people far from the
 * existing listings still see them (with real distances) instead of an empty map.
 */
export const DEFAULT_FILTERS: DiscoveryFilters = {
  category: "ALL",
  radiusKm: "ANY",
  conditions: [],
  trustedOnly: false,
  availableNowOnly: false,
  sort: "nearest",
};

export const RADIUS_OPTIONS: (number | "ANY")[] = [1, 2, 5, 10, 25, 50, "ANY"];

export function activeFilterCount(f: DiscoveryFilters): number {
  return (
    (f.category !== "ALL" ? 1 : 0) +
    (f.radiusKm !== DEFAULT_FILTERS.radiusKm ? 1 : 0) +
    (f.conditions.length > 0 ? 1 : 0) +
    (f.trustedOnly ? 1 : 0) +
    (f.availableNowOnly ? 1 : 0)
  );
}
