"use client";

import clsx from "clsx";
import type { Map as MapLibreMap, MapOptions, StyleSpecification } from "maplibre-gl";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { buildLendLoopStyle } from "./lendloopStyle";
import { loadMapEngine, MAPBOX_STANDARD_CONFIG, MAPBOX_STYLE_URL, type MapEngineKind, type MapLib } from "./mapEngine";
import styles from "./MapView.module.scss";

interface MapContextValue {
  map: MapLibreMap;
  lib: MapLib;
  engine: MapEngineKind;
  container: HTMLDivElement;
}

const MapContext = createContext<MapContextValue | null>(null);

export function useMapContext(): MapContextValue {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("Map components must be rendered inside <MapView>");
  return ctx;
}

const STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL;

export interface MapViewProps {
  /** [lng, lat] */
  center: [number, number];
  zoom: number;
  className?: string;
  interactive?: boolean;
  minZoom?: number;
  maxZoom?: number;
  onReady?: (map: MapLibreMap) => void;
  /** Rendered once the style has loaded, with access to the map via context. */
  children?: ReactNode;
  /** Overlays positioned over the map (controls, cards). */
  overlay?: ReactNode;
}

type Status = "loading" | "ready" | "error" | "unsupported";

/**
 * MapLibre GL map with a React context, in the spirit of mapcn: children
 * (markers, layers, controls) are ordinary React components.
 */
export default function MapView({ center, zoom, className, interactive = true, minZoom = 0.6, maxZoom = 19, onReady, children, overlay }: MapViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<MapContextValue | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [tilesFailed, setTilesFailed] = useState(false);
  // Initial camera only; later changes are driven imperatively by children.
  const initial = useRef({ center, zoom });
  const readyCb = useRef(onReady);
  useEffect(() => {
    readyCb.current = onReady;
  });

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;
    let engineKind: MapEngineKind | null = null;
    let engineLib: MapLib | null = null;
    let resize: ResizeObserver | null = null;
    loadMapEngine()
      .then(({ kind, lib }) => {
        if (disposed || !containerRef.current) return;
        // Shared camera/interaction options; zoom out all the way to the globe.
        const common = {
          container: containerRef.current,
          center: initial.current.center,
          zoom: initial.current.zoom,
          minZoom,
          maxZoom,
          interactive,
          dragRotate: interactive,
          pitchWithRotate: false,
        };
        try {
          map =
            kind === "mapbox"
              ? new lib.Map({
                  ...common,
                  style: MAPBOX_STYLE_URL,
                  projection: "globe",
                  config: { basemap: MAPBOX_STANDARD_CONFIG },
                  attributionControl: true,
                  logoPosition: "bottom-left",
                } as unknown as MapOptions)
              : new lib.Map({
                  ...common,
                  style: STYLE_URL ?? (buildLendLoopStyle() as StyleSpecification),
                  attributionControl: { compact: true },
                  fadeDuration: 150,
                });
        } catch {
          setStatus("unsupported");
          return;
        }
        if (kind === "maplibre") {
          // MapLibre 5+: globe projection when zoomed out, Mercator up close.
          map.on("style.load", () => map?.setProjection({ type: "globe" }));
        }
        engineKind = kind;
        engineLib = lib;
        let tileErrors = 0;
        map.on("error", (e) => {
          // Count network failures for tiles/style; surface a banner instead of a blank map.
          if (e.error && /fetch|load|Failed|network|Unauthorized|401|403/i.test(String(e.error.message))) {
            tileErrors += 1;
            if (tileErrors >= 4) setTilesFailed(true);
          }
        });
        map.once("load", () => {
          if (disposed || !map || !containerRef.current || !engineKind || !engineLib) return;
          setCtx({ map, lib: engineLib, engine: engineKind, container: containerRef.current });
          setStatus("ready");
          readyCb.current?.(map);
        });
        resize = new ResizeObserver(() => map?.resize());
        resize.observe(containerRef.current);
      })
      .catch(() => setStatus("error"));
    return () => {
      disposed = true;
      resize?.disconnect();
      map?.remove();
      setCtx(null);
    };
    // Map is created once per mount; props are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={wrapRef} className={clsx(styles.wrap, className)} data-map-status={status}>
      <div ref={containerRef} className={styles.map} />
      {status === "loading" && <div className={styles.loading} aria-hidden />}
      {(status === "error" || status === "unsupported") && (
        <div className={styles.notice} role="status">
          {status === "unsupported"
            ? "Your browser can't display the interactive map (WebGL is unavailable). The list still works."
            : "The map couldn't load. Check your connection — the list still works."}
        </div>
      )}
      {tilesFailed && status === "ready" && (
        <div className={styles.notice} role="status">
          Some map tiles couldn&apos;t load. Tools are still listed.
        </div>
      )}
      {ctx && <MapContext.Provider value={ctx}>{children}</MapContext.Provider>}
      {ctx && overlay && <MapContext.Provider value={ctx}>{overlay}</MapContext.Provider>}
    </div>
  );
}
