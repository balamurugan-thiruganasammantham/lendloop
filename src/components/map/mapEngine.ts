"use client";

/**
 * Map engine selection.
 *
 *  - With NEXT_PUBLIC_MAPBOX_TOKEN: Mapbox GL JS v3 + the Mapbox Standard style
 *    (faded theme, globe) — the same base map family startupmap.one uses.
 *  - Without a token: MapLibre GL + the open LendLoop style on OpenFreeMap
 *    tiles, so the project runs with no third-party account.
 *
 * Both libraries share the same core API (Map, Marker, LngLatBounds, sources,
 * layers, camera), so the rest of the map code is engine-agnostic. The module
 * is typed with MapLibre's declarations; Mapbox is structurally compatible for
 * the subset LendLoop uses.
 */
import type * as MapLibre from "maplibre-gl";

export type MapLib = typeof MapLibre;
export type MapEngineKind = "mapbox" | "maplibre";

export interface MapEngine {
  kind: MapEngineKind;
  lib: MapLib;
}

export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim() || null;
export const MAPBOX_STYLE_URL = process.env.NEXT_PUBLIC_MAPBOX_STYLE_URL?.trim() || "mapbox://styles/mapbox/standard";

/**
 * Mapbox Standard configuration tuned to a quiet, editorial look: faded
 * palette, periwinkle roads, blue-grey water, no POI / transit / road labels
 * and no 3D objects, so the circular tool pins carry the colour.
 */
export const MAPBOX_STANDARD_CONFIG = {
  theme: "faded",
  lightPreset: "day",
  colorLand: "#efede9",
  colorWater: "#c7ccd6",
  colorGreenspace: "#dfe3d6",
  colorBuildings: "#e6e3de",
  colorPlaceLabels: "#5f636c",
  showPointOfInterestLabels: false,
  showTransitLabels: false,
  showRoadLabels: false,
  showLandmarkIcons: false,
  showLandmarkIconLabels: false,
  show3dObjects: false,
} as const;

let promise: Promise<MapEngine> | null = null;

export function loadMapEngine(): Promise<MapEngine> {
  promise ??= (
    MAPBOX_TOKEN
      ? import("mapbox-gl").then((mod) => {
          const lib = ((mod as { default?: unknown }).default ?? mod) as MapLib & { accessToken: string };
          lib.accessToken = MAPBOX_TOKEN!;
          return { kind: "mapbox" as const, lib };
        })
      : import("maplibre-gl").then((lib) => {
          lib.setWorkerUrl(`/vendor/maplibre-gl-worker-${lib.getVersion()}.mjs`);
          return { kind: "maplibre" as const, lib: lib as MapLib };
        })
  ).catch((error: unknown) => {
    promise = null;
    throw error;
  });
  return promise;
}
