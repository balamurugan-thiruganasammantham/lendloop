"use client";

import type { PaddingOptions } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { useMapContext } from "./MapView";

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Fly to a point whenever `target.key` changes. */
export function FlyTo({ target, zoom, padding }: { target: { lat: number; lng: number; key: string } | null; zoom?: number; padding?: Partial<PaddingOptions> }) {
  const { map } = useMapContext();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!target || target.key === last.current) return;
    last.current = target.key;
    const options = {
      center: [target.lng, target.lat] as [number, number],
      zoom: zoom ?? Math.max(map.getZoom(), 14.5),
      padding: { top: 0, bottom: 0, left: 0, right: 0, ...padding },
      duration: prefersReducedMotion() ? 0 : 900,
      essential: true,
    };
    map.flyTo(options);
  }, [map, target, zoom, padding]);
  return null;
}

/** Fit all points once per `signature`. */
export function FitPoints({
  points,
  signature,
  padding = 64,
  maxZoom = 15,
  duration = 0,
}: {
  points: [number, number][];
  signature: string;
  padding?: number | Partial<PaddingOptions>;
  maxZoom?: number;
  /** Animate the first fit (e.g. a globe → neighbourhood intro). */
  duration?: number;
}) {
  const { map, lib } = useMapContext();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (points.length === 0 || signature === last.current) return;
    last.current = signature;
    const pad: number | PaddingOptions = typeof padding === "number" ? padding : { top: 0, bottom: 0, left: 0, right: 0, ...padding };
    const animate = duration > 0 && !prefersReducedMotion();
    if (points.length === 1) {
      map.flyTo({ center: [points[0]![1], points[0]![0]], zoom: maxZoom, duration: animate ? duration : 0, essential: true });
      return;
    }
    const bounds = new lib.LngLatBounds();
    for (const [lat, lng] of points) bounds.extend([lng, lat]);
    if (!animate) {
      map.fitBounds(bounds, { padding: pad, maxZoom, duration: 0 });
      return;
    }
    // Let the globe render first, then glide in once its tiles are ready.
    let timer: number | undefined;
    const start = () => {
      timer = window.setTimeout(() => {
        map.fitBounds(bounds, { padding: pad, maxZoom, duration, essential: true, curve: 1.6 } as Parameters<typeof map.fitBounds>[1]);
      }, 900);
    };
    if (map.loaded()) start();
    else map.once("idle", start);
    return () => {
      window.clearTimeout(timer);
      map.off("idle", start);
    };
  }, [map, lib, points, signature, padding, maxZoom, duration]);
  return null;
}
