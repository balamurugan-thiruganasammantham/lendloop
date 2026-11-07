import { describe, expect, it } from "vitest";
import { distanceLabel, distanceTo, metersBetween, shouldAcceptFix, sortByDistance, withLiveDistances, type Fix } from "@/lib/location";

const home = { lat: 11.9254, lng: 79.8277 }; // Puducherry

function fix(lat: number, lng: number, accuracy: number | null, at = 0): Fix {
  return { point: { lat, lng }, accuracy, at };
}

describe("live location helpers", () => {
  it("measures short distances in metres", () => {
    // 0.001° of latitude ≈ 111 m
    expect(metersBetween(home, { lat: home.lat + 0.001, lng: home.lng })).toBeCloseTo(111, -1);
  });

  it("ignores GPS jitter but accepts real movement", () => {
    const first = fix(home.lat, home.lng, 30, 0);
    expect(shouldAcceptFix(null, first)).toBe(true);
    expect(shouldAcceptFix(first, fix(home.lat + 0.00005, home.lng, 30, 5_000))).toBe(false); // ~5 m
    expect(shouldAcceptFix(first, fix(home.lat + 0.0003, home.lng, 30, 5_000))).toBe(true); // ~33 m
  });

  it("accepts a much more precise fix at the same place, and refreshes stale fixes", () => {
    const coarse = fix(home.lat, home.lng, 900, 0);
    expect(shouldAcceptFix(coarse, fix(home.lat, home.lng, 25, 1_000))).toBe(true);
    expect(shouldAcceptFix(fix(home.lat, home.lng, 25, 0), fix(home.lat, home.lng, 25, 61_000))).toBe(true);
  });

  it("recomputes distances from the viewer's live point and sorts nearest first", () => {
    const items = [
      {
        id: "far",
        approxLat: home.lat + 0.05,
        approxLng: home.lng,
        distanceKm: 1,
      },
      {
        id: "near",
        approxLat: home.lat + 0.004,
        approxLng: home.lng,
        distanceKm: 9,
      },
    ];
    const live = withLiveDistances(items, home);
    expect(live.find((i) => i.id === "near")!.distanceKm).toBeCloseTo(0.445, 2);
    expect(sortByDistance(live).map((i) => i.id)).toEqual(["near", "far"]);
    expect(withLiveDistances(items, null)).toBe(items);
  });

  it("formats labels in metres or kilometres", () => {
    expect(distanceLabel(distanceTo(home, { approxLat: home.lat + 0.004, approxLng: home.lng }))).toBe("450 m");
    expect(distanceLabel(2.345)).toBe("2.3 km");
    expect(distanceLabel(null)).toBeNull();
  });
});

describe("describePosition", () => {
  it("is honest about network estimates and chosen places", async () => {
    const { describePosition } = await import("@/lib/location");
    expect(describePosition({ source: "gps", label: null, accuracy: 25 })).toMatchObject({ label: "Your location", approximate: false });
    expect(describePosition({ source: "gps", label: null, accuracy: 24_000 })).toMatchObject({ label: "Approximate location (±24 km)", approximate: true });
    expect(describePosition({ source: "manual", label: "Puducherry, India", accuracy: null })).toMatchObject({ label: "Puducherry", manual: true });
  });
});
