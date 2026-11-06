"use client";

import clsx from "clsx";
import type { Map as MapLibreMap } from "maplibre-gl";
import { Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import Supercluster from "supercluster";
import type { ToolCategory } from "@convex/lib/constants";
import { CATEGORY_ICONS } from "@/components/common/ToolThumb";
import { MapMarker } from "./MapMarker";
import { useMapContext } from "./MapView";
import styles from "./ToolPins.module.scss";

export interface PinItem {
  id: string;
  name: string;
  /** City/area used for the zoomed-out region pill, e.g. "Bengaluru". */
  region?: string;
  category: ToolCategory;
  lat: number;
  lng: number;
  imageUrl: string | null;
  /** available → green dot, reserved → amber dot */
  availability: "available" | "reserved";
  trusted?: boolean;
  meta?: string;
  /** "850 m" / "1.2 km" from the viewer, shown under the name. */
  distance?: string | null;
}

interface Props {
  items: PinItem[];
  selectedId: string | null;
  hoveredId?: string | null;
  onSelect: (id: string) => void;
  onHover?: (id: string | null) => void;
  /** Labels appear from this zoom level (always on the selected pin). */
  labelMinZoom?: number;
}

type ViewState = { bbox: [number, number, number, number]; zoom: number };

const WORLD: ViewState["bbox"] = [-180, -85, 180, 85];

/** "Indiranagar, Bengaluru" → "Bengaluru" (falls back to the whole label). */
export function regionOf(pickupArea: string): string {
  const parts = pickupArea
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1]! : (parts[0] ?? pickupArea);
}

/** Viewport bbox for clustering; robust to globe views (null bounds, >360° spans). */
function readView(map: MapLibreMap): ViewState {
  const zoom = map.getZoom();
  const b = map.getBounds() as ReturnType<MapLibreMap["getBounds"]> | null;
  if (!b || zoom < 3) return { bbox: WORLD, zoom };
  let west = b.getWest();
  let east = b.getEast();
  if (east - west >= 360) {
    west = -180;
    east = 180;
  }
  const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;
  return {
    bbox: [wrap(west), Math.max(-85, b.getSouth()), wrap(east) || 180, Math.min(85, b.getNorth())],
    zoom,
  };
}

/** Most common region among a cluster's tools. */
function dominantRegion(items: PinItem[]): string | null {
  const counts = new Map<string, number>();
  for (const i of items) if (i.region) counts.set(i.region, (counts.get(i.region) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [r, c] of counts) if (c > n) [best, n] = [r, c];
  return best;
}

export function PinImage({ item, size }: { item: Pick<PinItem, "imageUrl" | "category" | "name">; size?: "sm" }) {
  const Icon = CATEGORY_ICONS[item.category];
  return (
    <span className={clsx(styles.image, size === "sm" && styles.imageSm)}>
      {item.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Convex storage URL inside a map marker
        <img src={item.imageUrl} alt="" draggable={false} loading="lazy" />
      ) : (
        <Icon aria-hidden strokeWidth={1.6} />
      )}
    </span>
  );
}

function ToolPin({
  item,
  state,
  showLabel,
  onSelect,
  onHover,
}: {
  item: PinItem;
  state: "rest" | "hover" | "selected";
  showLabel: boolean;
  onSelect: () => void;
  onHover?: (id: string | null) => void;
}) {
  return (
    <button
      type="button"
      className={clsx(styles.pin, state === "hover" && styles.hover, state === "selected" && styles.selected, item.trusted && styles.trusted)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHover?.(null)}
      aria-label={`${item.name}${item.meta ? `, ${item.meta}` : ""}`}
      aria-pressed={state === "selected"}
    >
      <span className={styles.ring}>
        <PinImage item={item} />
        <span className={clsx(styles.dot, item.availability === "reserved" && styles.dotReserved)} aria-hidden />
        {item.trusted && (
          <span className={styles.star} aria-hidden>
            <Star />
          </span>
        )}
      </span>
      {(showLabel || state !== "rest") && (
        <span className={styles.label}>
          <span className={styles.labelName}>{item.name}</span>
          {item.distance && <span className={clsx(styles.labelDistance, "num")}>{item.distance}</span>}
        </span>
      )}
    </button>
  );
}

/**
 * Circular product pins with client-side clustering (Supercluster). The
 * selected pin is rendered outside the clusters so it is always visible.
 */
/** Below this zoom, clusters render as region pills ("Bengaluru · 17 tools"). */
const REGION_PILL_MAX_ZOOM = 9;

export function ToolPins({ items, selectedId, hoveredId, onSelect, onHover, labelMinZoom = 12.5 }: Props) {
  const { map } = useMapContext();
  const [view, setView] = useState<ViewState>(() => readView(map));

  useEffect(() => {
    const update = () => setView(readView(map));
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [map]);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const index = useMemo(() => {
    const sc = new Supercluster<{ id: string }>({
      radius: 48,
      maxZoom: 16,
      minPoints: 2,
    });
    sc.load(
      items
        .filter((i) => i.id !== selectedId)
        .map((i) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [i.lng, i.lat] },
          properties: { id: i.id },
        })),
    );
    return sc;
  }, [items, selectedId]);

  const clusters = useMemo(() => {
    const [w, s, e, n] = view.bbox;
    // Pad the viewport so pins don't pop at the edges while panning.
    const padX = (e - w) * 0.2;
    const padY = (n - s) * 0.2;
    return index.getClusters([w - padX, s - padY, e + padX, n + padY], Math.floor(view.zoom));
  }, [index, view]);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  const showLabels = view.zoom >= labelMinZoom;

  return (
    <>
      {clusters.map((feature) => {
        const [lng, lat] = feature.geometry.coordinates as [number, number];
        const props = feature.properties as {
          cluster?: boolean;
          cluster_id?: number;
          point_count?: number;
          id?: string;
        };
        if (props.cluster && props.cluster_id !== undefined) {
          const clusterId = props.cluster_id;
          const count = props.point_count ?? 0;
          const zoomIn = () => {
            const zoom = Math.min(index.getClusterExpansionZoom(clusterId), 17);
            map.flyTo({
              center: [lng, lat],
              zoom: Math.max(zoom, view.zoom < REGION_PILL_MAX_ZOOM ? 11.5 : zoom),
              duration: 1400,
              essential: true,
            });
          };
          if (view.zoom < REGION_PILL_MAX_ZOOM) {
            const leaves = index
              .getLeaves(clusterId, 50)
              .map((l) => byId.get(l.properties.id))
              .filter((x): x is PinItem => !!x);
            const region = dominantRegion(leaves) ?? "Nearby";
            return (
              <MapMarker key={`r${clusterId}`} lng={lng} lat={lat} zIndex={15}>
                <button
                  type="button"
                  className={styles.region}
                  onClick={(e) => {
                    e.stopPropagation();
                    zoomIn();
                  }}
                  aria-label={`${region}: ${count} tools — zoom in`}
                >
                  {leaves[0] && <PinImage item={leaves[0]} size="sm" />}
                  <span className={styles.regionText}>
                    <span className={clsx(styles.regionName, "display")}>{region}</span>
                    <span className={styles.regionCount}>
                      <span className="num">{count}</span> tools
                    </span>
                  </span>
                </button>
              </MapMarker>
            );
          }
          const leaves = index
            .getLeaves(clusterId, 3)
            .map((l) => byId.get(l.properties.id))
            .filter((x): x is PinItem => !!x);
          return (
            <MapMarker key={`c${clusterId}`} lng={lng} lat={lat} zIndex={15}>
              <button
                type="button"
                className={styles.cluster}
                aria-label={`${count} tools here — zoom in`}
                onClick={(e) => {
                  e.stopPropagation();
                  zoomIn();
                }}
              >
                <span className={styles.stack}>
                  {leaves.map((leaf) => (
                    <PinImage key={leaf.id} item={leaf} size="sm" />
                  ))}
                </span>
                <span className={clsx(styles.count, "num")}>{count}</span>
              </button>
            </MapMarker>
          );
        }
        if (view.zoom < REGION_PILL_MAX_ZOOM && items.length > 1) {
          // A lone tool far from the rest: still show a region pill when zoomed out.
          const item = props.id ? byId.get(props.id) : undefined;
          if (!item) return null;
          return (
            <MapMarker key={`rp${item.id}`} lng={lng} lat={lat} zIndex={15}>
              <button
                type="button"
                className={styles.region}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(item.id);
                }}
                aria-label={`${item.name}, ${item.region ?? ""}`}
              >
                <PinImage item={item} size="sm" />
                <span className={styles.regionText}>
                  <span className={clsx(styles.regionName, "display")}>{item.region ?? item.name}</span>
                  <span className={styles.regionCount}>1 tool</span>
                </span>
              </button>
            </MapMarker>
          );
        }
        const item = props.id ? byId.get(props.id) : undefined;
        if (!item) return null;
        const state = hoveredId === item.id ? "hover" : "rest";
        return (
          <MapMarker key={item.id} lng={item.lng} lat={item.lat} zIndex={state === "hover" ? 900 : 10}>
            <ToolPin item={item} state={state} showLabel={showLabels} onSelect={() => onSelect(item.id)} onHover={onHover} />
          </MapMarker>
        );
      })}
      {selected && (
        <MapMarker key={`sel-${selected.id}`} lng={selected.lng} lat={selected.lat} zIndex={1000}>
          <ToolPin item={selected} state="selected" showLabel onSelect={() => onSelect(selected.id)} onHover={onHover} />
        </MapMarker>
      )}
    </>
  );
}
