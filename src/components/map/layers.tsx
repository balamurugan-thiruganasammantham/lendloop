"use client";

import type { GeoJSONSource, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import type { LatLng } from "@convex/lib/geo";
import { useMapContext } from "./MapView";

type LayerDef = Omit<LayerSpecification, "source" | "id"> & { id: string };

/** First symbol layer, so data layers render beneath place labels. */
function firstSymbolLayer(map: MapLibreMap): string | undefined {
  return map.getStyle().layers.find((l) => l.type === "symbol")?.id;
}

/** Declarative GeoJSON source + layers, updated in place when data changes. */
export function GeoJsonLayer({ id, data, layers, belowLabels = true }: { id: string; data: GeoJSON.GeoJSON; layers: LayerDef[]; belowLabels?: boolean }) {
  const { map, engine } = useMapContext();
  const added = useRef(false);

  useEffect(() => {
    map.addSource(id, { type: "geojson", data });
    if (engine === "mapbox") {
      // Mapbox Standard composes the basemap in slots; "middle" sits above roads, below labels.
      for (const layer of layers) map.addLayer({ ...layer, source: id, slot: belowLabels ? "middle" : "top" } as unknown as LayerSpecification);
    } else {
      const before = belowLabels ? firstSymbolLayer(map) : undefined;
      for (const layer of layers) map.addLayer({ ...layer, source: id } as LayerSpecification, before);
    }
    added.current = true;
    return () => {
      added.current = false;
      // The map may already be torn down when the parent unmounts.
      if (!map.getStyle()) return;
      for (const layer of layers) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
      if (map.getSource(id)) map.removeSource(id);
    };
    // Layers are static per mount; data updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, engine, id]);

  useEffect(() => {
    if (added.current) (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  }, [map, id, data]);

  return null;
}

/** Polygon approximating a circle of `radiusKm` around `center`. */
export function circlePolygon(center: LatLng, radiusKm: number, steps = 72): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = radiusKm / 110.574;
  const dLng = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    coords.push([center.lng + dLng * Math.cos(t), center.lat + dLat * Math.sin(t)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

export function RadiusRing({ center, radiusKm }: { center: LatLng; radiusKm: number }) {
  return (
    <GeoJsonLayer
      id="radius-ring"
      data={circlePolygon(center, radiusKm)}
      layers={[
        { id: "radius-ring-fill", type: "fill", paint: { "fill-color": "#1f4d3a", "fill-opacity": 0.035 } },
        { id: "radius-ring-line", type: "line", paint: { "line-color": "#1f4d3a", "line-opacity": 0.35, "line-width": 1.2, "line-dasharray": [3, 3] } },
      ]}
    />
  );
}

export function AccuracyCircle({ center, meters }: { center: LatLng; meters: number }) {
  return (
    <GeoJsonLayer
      id="accuracy-circle"
      data={circlePolygon(center, meters / 1000)}
      layers={[{ id: "accuracy-fill", type: "fill", paint: { "fill-color": "#2c557d", "fill-opacity": 0.08 } }]}
    />
  );
}

export function RouteLine({ path }: { path: [number, number][] }) {
  const data: GeoJSON.Feature<GeoJSON.LineString> = {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: path.map(([lat, lng]) => [lng, lat]) },
  };
  return (
    <GeoJsonLayer
      id="route"
      data={data}
      layers={[
        { id: "route-casing", type: "line", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 8 } },
        { id: "route-line", type: "line", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1f1b16", "line-width": 4 } },
      ]}
    />
  );
}
