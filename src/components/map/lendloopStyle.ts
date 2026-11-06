/**
 * LendLoop basemap: a quiet, editorial vector style built on OpenStreetMap
 * data served by OpenFreeMap (free, no API key, OpenMapTiles schema).
 *
 * Palette: warm light-grey land, blue-grey water, soft periwinkle roads and
 * muted parks, so the circular tool pins carry the colour. Swap the whole
 * style with NEXT_PUBLIC_MAP_STYLE_URL (e.g. a MapTiler or CARTO style URL).
 */
import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";

const TILES = process.env.NEXT_PUBLIC_MAP_TILES_URL ?? "https://tiles.openfreemap.org/planet";
const GLYPHS = process.env.NEXT_PUBLIC_MAP_GLYPHS_URL ?? "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

export const MAP_COLORS = {
  land: "#efede9",
  landResidential: "#ebe9e5",
  landIndustrial: "#e7e5e1",
  park: "#dfe2d8",
  wood: "#d9ddd2",
  water: "#c9ced8",
  waterLine: "#bec4d0",
  building: "#e2e0dc",
  buildingOutline: "#d6d4cf",
  roadMajor: "#b6bed6",
  roadMinor: "#c8cede",
  roadService: "#d9dce5",
  roadCasing: "#e9e8e6",
  path: "#d3d5db",
  rail: "#c8c9ce",
  label: "#6f737d",
  labelSoft: "#9da2ae",
  labelHalo: "rgba(239, 237, 233, 0.9)",
} as const;

const REGULAR = ["Noto Sans Regular"];
const BOLD = ["Noto Sans Bold"];

/** Prefer English names (falls back to the local-language name). */
const NAME: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];
const ITALIC = ["Noto Sans Italic"];

/** Zoom-interpolated line width helper. */
function width(stops: [number, number][]): ExpressionSpecification {
  return ["interpolate", ["exponential", 1.4], ["zoom"], ...stops.flat()] as ExpressionSpecification;
}

const isRoad = (classes: string[]): ExpressionSpecification =>
  ["all", ["match", ["get", "class"], classes, true, false], ["!=", ["get", "brunnel"], "tunnel"]] as ExpressionSpecification;

export function buildLendLoopStyle(): StyleSpecification {
  const c = MAP_COLORS;
  return {
    version: 8,
    name: "LendLoop Light",
    glyphs: GLYPHS,
    sources: {
      openmaptiles: {
        type: "vector",
        url: TILES,
        attribution:
          '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": c.land } },
      {
        id: "landuse-residential",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["match", ["get", "class"], ["residential", "suburb", "neighbourhood"], true, false],
        paint: { "fill-color": c.landResidential },
      },
      {
        id: "landuse-industrial",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["match", ["get", "class"], ["industrial", "commercial", "retail", "railway", "garages"], true, false],
        paint: { "fill-color": c.landIndustrial },
      },
      {
        id: "landcover-wood",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["match", ["get", "class"], ["wood", "forest"], true, false],
        paint: { "fill-color": c.wood, "fill-opacity": 0.8 },
      },
      {
        id: "landcover-grass",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landcover",
        filter: ["match", ["get", "class"], ["grass", "farmland", "wetland"], true, false],
        paint: { "fill-color": c.park, "fill-opacity": 0.6 },
      },
      {
        id: "park",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "park",
        paint: { "fill-color": c.park, "fill-opacity": 0.9 },
      },
      {
        id: "landuse-pitch",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "landuse",
        filter: ["match", ["get", "class"], ["pitch", "stadium", "cemetery", "school", "hospital"], true, false],
        paint: { "fill-color": c.landIndustrial },
      },
      {
        id: "water",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "water",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: { "fill-color": c.water },
      },
      {
        id: "waterway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "waterway",
        filter: ["!=", ["get", "brunnel"], "tunnel"],
        paint: { "line-color": c.waterLine, "line-width": width([[10, 0.5], [16, 3]]) },
      },
      {
        id: "aeroway-area",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "aeroway",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": c.landIndustrial },
      },
      {
        id: "aeroway-runway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "aeroway",
        filter: ["match", ["get", "class"], ["runway", "taxiway"], true, false],
        paint: { "line-color": c.roadService, "line-width": width([[11, 2], [16, 24]]) },
      },
      {
        id: "building",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 14.5,
        paint: {
          "fill-color": c.building,
          "fill-outline-color": c.buildingOutline,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14.5, 0, 16, 1],
        },
      },
      {
        id: "road-path",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 14,
        filter: isRoad(["path", "track"]),
        paint: { "line-color": c.path, "line-width": width([[14, 0.5], [18, 1.5]]), "line-dasharray": [2, 1.5] },
      },
      {
        id: "road-service",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 13,
        filter: isRoad(["service"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.roadService, "line-width": width([[13, 0.5], [18, 6]]) },
      },
      {
        id: "road-minor",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 11,
        filter: isRoad(["minor"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.roadMinor, "line-width": width([[11, 0.4], [14, 1.4], [18, 9]]) },
      },
      {
        id: "railway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 11,
        filter: isRoad(["rail", "transit"]),
        paint: { "line-color": c.rail, "line-width": width([[11, 0.6], [16, 1.6]]) },
      },
      {
        id: "road-secondary",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 9,
        filter: isRoad(["secondary", "tertiary"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.roadMajor, "line-width": width([[9, 0.4], [12, 1.2], [14, 2.2], [18, 12]]), "line-opacity": 0.85 },
      },
      {
        id: "road-primary",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 7,
        filter: isRoad(["primary", "trunk"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.roadMajor, "line-width": width([[7, 0.5], [12, 1.8], [14, 3], [18, 16]]) },
      },
      {
        id: "road-motorway",
        type: "line",
        source: "openmaptiles",
        "source-layer": "transportation",
        minzoom: 5,
        filter: isRoad(["motorway"]),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.roadMajor, "line-width": width([[5, 0.5], [10, 1.6], [14, 3.4], [18, 18]]) },
      },
      {
        id: "boundary",
        type: "line",
        source: "openmaptiles",
        "source-layer": "boundary",
        filter: ["<=", ["get", "admin_level"], 4],
        paint: { "line-color": "#c9c6cf", "line-width": 1, "line-dasharray": [3, 2] },
      },
      {
        id: "water-label-point",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "water_name",
        minzoom: 11,
        filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": NAME, "text-font": ITALIC, "text-size": 12, "text-letter-spacing": 0.05 },
        paint: { "text-color": "#8e96a8", "text-halo-color": c.water, "text-halo-width": 1 },
      },
      {
        id: "water-label-line",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "water_name",
        minzoom: 11,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "text-field": NAME, "text-font": ITALIC, "text-size": 12, "symbol-placement": "line" },
        paint: { "text-color": "#8e96a8", "text-halo-color": c.water, "text-halo-width": 1 },
      },
      {
        id: "road-label",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        minzoom: 15,
        filter: ["match", ["get", "class"], ["primary", "secondary", "tertiary", "minor", "trunk"], true, false],
        layout: {
          "text-field": NAME,
          "text-font": REGULAR,
          "text-size": ["interpolate", ["linear"], ["zoom"], 14, 10, 18, 12],
          "symbol-placement": "line",
          "text-max-angle": 30,
        },
        paint: { "text-color": c.labelSoft, "text-halo-color": c.labelHalo, "text-halo-width": 1.4 },
      },
      {
        id: "place-neighbourhood",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 12,
        maxzoom: 17,
        filter: ["match", ["get", "class"], ["suburb", "neighbourhood", "quarter"], true, false],
        layout: {
          "text-field": ["upcase", NAME],
          "text-font": REGULAR,
          "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 12],
          "text-letter-spacing": 0.14,
          "text-max-width": 8,
        },
        paint: { "text-color": c.labelSoft, "text-halo-color": c.labelHalo, "text-halo-width": 1.2 },
      },
      {
        id: "place-village",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 10,
        filter: ["match", ["get", "class"], ["village", "hamlet"], true, false],
        layout: { "text-field": NAME, "text-font": REGULAR, "text-size": 12 },
        paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1.4 },
      },
      {
        id: "place-town",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 8,
        filter: ["==", ["get", "class"], "town"],
        layout: { "text-field": NAME, "text-font": REGULAR, "text-size": ["interpolate", ["linear"], ["zoom"], 8, 11, 14, 15] },
        paint: { "text-color": c.label, "text-halo-color": c.labelHalo, "text-halo-width": 1.5 },
      },
      {
        id: "place-city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        minzoom: 4,
        maxzoom: 14,
        filter: ["==", ["get", "class"], "city"],
        layout: {
          "text-field": NAME,
          "text-font": BOLD,
          "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 12, 18],
          "text-letter-spacing": 0.02,
        },
        paint: { "text-color": "#5f636c", "text-halo-color": c.labelHalo, "text-halo-width": 1.6 },
      },
      {
        id: "place-country",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        maxzoom: 7,
        filter: ["==", ["get", "class"], "country"],
        layout: { "text-field": NAME, "text-font": BOLD, "text-size": 13, "text-letter-spacing": 0.1, "text-transform": "uppercase" },
        paint: { "text-color": "#8a8e99", "text-halo-color": c.labelHalo, "text-halo-width": 1.5 },
      },
    ],
  };
}
