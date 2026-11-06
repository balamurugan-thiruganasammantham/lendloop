import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { approvedLoan, createTool, createUser, EXACT, setup, window } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const exactLat = String(EXACT.lat);
const exactLng = String(EXACT.lng);

function leaksExact(value: unknown): boolean {
  const s = JSON.stringify(value);
  return s.includes(exactLat) || s.includes(exactLng) || s.includes("Secret Lane");
}

describe("location privacy", () => {
  it("never exposes the exact pickup point or owner identity publicly", async () => {
    const t = setup();
    const owner = await createUser(t, "owner", "Arun Kumar");
    await createTool(t, owner);
    const preview = await t.query(api.tools.publicPreview, {});
    expect(preview.items).toHaveLength(1);
    expect(leaksExact(preview)).toBe(false);
    const item = preview.items[0]!;
    expect(Object.keys(item).sort()).toEqual(
      ["approxLat", "approxLng", "availableNow", "category", "condition", "id", "imageUrl", "isSeed", "name", "pickupArea"].sort(),
    );
    expect(JSON.stringify(preview)).not.toContain("Arun");
    expect(JSON.stringify(preview)).not.toContain("owner@example.com");
  });

  it("shows owners their own listings on the map, flagged as theirs", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const toolId = await createTool(t, owner);
    const disc = await owner.as.query(api.tools.discover, { center: { lat: 12.97, lng: 77.64 }, radiusKm: 5 });
    expect(disc.items.find((i) => i.id === toolId)).toMatchObject({ isMine: true });
    const viewer = await createUser(t, "viewer");
    const other = await viewer.as.query(api.tools.discover, { center: { lat: 12.97, lng: 77.64 }, radiusKm: 5 });
    expect(other.items.find((i) => i.id === toolId)).toMatchObject({ isMine: false });
  });

  it("only shows approximate coordinates in discovery and details", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const viewer = await createUser(t, "viewer");
    const toolId = await createTool(t, owner);
    const disc = await viewer.as.query(api.tools.discover, { center: { lat: 12.97, lng: 77.64 }, radiusKm: 5 });
    const details = await viewer.as.query(api.tools.get, { toolId });
    expect(leaksExact(disc)).toBe(false);
    expect(leaksExact(details)).toBe(false);
    expect(JSON.stringify(details)).not.toContain("owner@example.com");
    // Approximate point is close but not exact.
    expect(Math.abs(details!.approxLat - EXACT.lat)).toBeLessThan(0.01);
  });

  it("reveals the exact pickup point only to the approved borrower of that loan", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const other = await createUser(t, "other");
    const toolId = await createTool(t, owner);

    // A pending request does not reveal anything.
    const pendingId = await other.as.mutation(api.requests.create, { toolId, ...window(20, 1) });
    expect(leaksExact(await other.as.query(api.requests.mine, {}))).toBe(false);
    expect(pendingId).toBeTruthy();

    const { loanId } = await approvedLoan(t, owner, borrower).then(async (r) => r);
    const loanForBorrower = await borrower.as.query(api.loans.get, { loanId });
    expect(loanForBorrower!.pickup).not.toBeNull();
    expect(await other.as.query(api.loans.get, { loanId })).toBeNull();
    expect(leaksExact(await other.as.query(api.tools.get, { toolId }))).toBe(false);
  });

  it("coarsens the user's own profile location to ~1 km", async () => {
    const t = setup();
    const u = await createUser(t, "u");
    await u.as.mutation(api.users.updateProfile, {
      name: "U Tester",
      locationSharing: true,
      approxLocation: { lat: 12.971612, lng: 77.641249 },
      areaLabel: "Indiranagar",
    });
    const me = await u.as.query(api.users.me, {});
    expect(me).toMatchObject({ approxLat: 12.97, approxLng: 77.64 });
    const stored = await t.run((ctx) => ctx.db.get(u.userId));
    expect(stored!.approxLat).toBe(12.97);
  });

  it("returns only safe fields on another user's reputation profile", async () => {
    const t = setup();
    const a = await createUser(t, "alpha");
    const b = await createUser(t, "beta");
    const rep = await b.as.query(api.users.reputation, { userId: a.userId });
    const s = JSON.stringify(rep);
    expect(s).not.toContain("alpha@example.com");
    expect(s).not.toContain("tokenIdentifier");
    expect(s).not.toContain("clerk");
  });
});
