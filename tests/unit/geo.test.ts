import { describe, expect, it } from "vitest";
import {
  approximateLocation,
  boundingBox,
  coarsen,
  formatDistance,
  haversineKm,
  inBox,
  isValidLatLng,
} from "@convex/lib/geo";

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm({ lat: 12.97, lng: 77.64 }, { lat: 12.97, lng: 77.64 })).toBe(0);
  });

  it("matches known city distances within 1%", () => {
    // Bengaluru (MG Road) → Chennai Central ≈ 290 km great-circle.
    const d = haversineKm({ lat: 12.9756, lng: 77.6066 }, { lat: 13.0827, lng: 80.2757 });
    expect(d).toBeGreaterThan(287);
    expect(d).toBeLessThan(292);
  });

  it("is symmetric", () => {
    const a = { lat: 51.5, lng: -0.12 };
    const b = { lat: 48.85, lng: 2.35 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });
});

describe("formatDistance", () => {
  it.each([
    [0.01, "50 m"],
    [0.348, "350 m"],
    [0.98, "1 km"],
    [1.234, "1.2 km"],
    [9.96, "10.0 km"],
    [14.4, "14 km"],
  ])("formats %s km as %s", (km, expected) => {
    expect(formatDistance(km)).toBe(expected);
  });

  it("handles invalid input", () => {
    expect(formatDistance(Number.NaN)).toBe("—");
    expect(formatDistance(-1)).toBe("—");
  });
});

describe("approximateLocation (privacy fuzzing)", () => {
  const exact = { lat: 12.97161, lng: 77.64125 };

  it("never returns the exact coordinate and stays within ~600 m", () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 500; i++) {
      const p = { lat: exact.lat + (rand() - 0.5) * 0.05, lng: exact.lng + (rand() - 0.5) * 0.05 };
      const approx = approximateLocation(p, rand);
      const d = haversineKm(p, approx);
      expect(d).toBeLessThan(0.65);
    }
  });

  it("maps points in the same cell to the same neighbourhood regardless of exact position", () => {
    const centre = () => 0.5; // no jitter
    // Two points inside the same grid cell (cell ≈ 0.004° lat × 0.0041° lng here).
    const a = approximateLocation({ lat: 12.97205, lng: 77.64005 }, centre);
    const b = approximateLocation({ lat: 12.97390, lng: 77.64195 }, centre);
    expect(a).toEqual(b);
    // ...and a point in the neighbouring cell maps elsewhere.
    const c = approximateLocation({ lat: 12.97610, lng: 77.64005 }, centre);
    expect(c).not.toEqual(a);
  });

  it("rounds output to 5 decimals", () => {
    const p = approximateLocation(exact, () => 0.123456789);
    expect(Number(p.lat.toFixed(5))).toBe(p.lat);
    expect(Number(p.lng.toFixed(5))).toBe(p.lng);
  });
});

describe("boundingBox / inBox", () => {
  it("contains every point within the radius", () => {
    const c = { lat: 12.97, lng: 77.64 };
    const box = boundingBox(c, 5);
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const rad = (bearing * Math.PI) / 180;
      const p = {
        lat: c.lat + (4.99 / 111.32) * Math.cos(rad),
        lng: c.lng + (4.99 / (111.32 * Math.cos((c.lat * Math.PI) / 180))) * Math.sin(rad),
      };
      expect(inBox(p, box)).toBe(true);
    }
    expect(inBox({ lat: c.lat + 0.2, lng: c.lng }, box)).toBe(false);
  });

  it("handles the antimeridian", () => {
    const box = boundingBox({ lat: 0, lng: 179.99 }, 10);
    expect(inBox({ lat: 0, lng: -179.99 }, box)).toBe(true);
    expect(inBox({ lat: 0, lng: 170 }, box)).toBe(false);
  });
});

describe("coarsen / isValidLatLng", () => {
  it("coarsens to ~1 km", () => {
    expect(coarsen({ lat: 12.971612, lng: 77.641249 })).toEqual({ lat: 12.97, lng: 77.64 });
  });
  it("validates ranges", () => {
    expect(isValidLatLng({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isValidLatLng({ lat: -33.86, lng: 151.2 })).toBe(true);
  });
});
