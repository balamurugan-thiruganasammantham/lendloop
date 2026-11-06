"use client";

import type { Marker, PositionAnchor } from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMapContext } from "./MapView";

export interface MapMarkerProps {
  lng: number;
  lat: number;
  children: ReactNode;
  anchor?: PositionAnchor;
  zIndex?: number;
  draggable?: boolean;
  onDragEnd?: (pos: { lng: number; lat: number }) => void;
  className?: string;
}

/** A MapLibre DOM marker whose content is rendered by React through a portal. */
export function MapMarker({ lng, lat, children, anchor = "center", zIndex, draggable = false, onDragEnd, className }: MapMarkerProps) {
  const { map, lib } = useMapContext();
  const [element] = useState(() => document.createElement("div"));
  const markerRef = useRef<Marker | null>(null);
  const dragCb = useRef(onDragEnd);
  useEffect(() => {
    dragCb.current = onDragEnd;
  });

  useEffect(() => {
    const marker = new lib.Marker({ element, anchor, draggable }).setLngLat([lng, lat]).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLngLat();
      dragCb.current?.({ lng: p.lng, lat: p.lat });
    });
    markerRef.current = marker;
    return () => {
      marker.remove();
      markerRef.current = null;
    };
    // Position updates are handled below without recreating the marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lib, element, anchor, draggable]);

  useEffect(() => {
    markerRef.current?.setLngLat([lng, lat]);
  }, [lng, lat]);

  // Style the host element through the marker instance (the portal target is immutable state).
  useEffect(() => {
    const host = markerRef.current?.getElement();
    if (host) host.style.zIndex = zIndex === undefined ? "" : String(zIndex);
  }, [zIndex]);

  // Add (never overwrite) classes: MapLibre's own marker classes position the element.
  useEffect(() => {
    const host = markerRef.current?.getElement();
    if (!host) return;
    const classes = ["ll-marker-host", ...(className ? className.split(" ") : [])];
    host.classList.add(...classes);
    return () => host.classList.remove(...classes);
  }, [className]);

  return createPortal(children, element);
}
