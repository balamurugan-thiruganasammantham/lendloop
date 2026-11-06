import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { TIME } from "../../convex/lib/constants";
import { createTool, createUser, drain, errorData, setup, window } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("borrow request validation", () => {
  it("rejects own tool, past dates, reversed dates and over-long loans", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(t, owner, { maxLoanDays: 3 });

    expect((await errorData(owner.as.mutation(api.requests.create, { toolId, ...window() }))).code).toBe("FORBIDDEN");

    const past = await errorData(
      borrower.as.mutation(api.requests.create, { toolId, pickupAt: Date.now() - TIME.day, returnBy: Date.now() + TIME.day }),
    );
    expect(past).toMatchObject({ code: "INVALID_INPUT", reason: "START_IN_PAST" });

    const w = window();
    const reversed = await errorData(borrower.as.mutation(api.requests.create, { toolId, pickupAt: w.returnBy, returnBy: w.pickupAt }));
    expect(reversed).toMatchObject({ reason: "END_BEFORE_START" });

    const tooLong = await errorData(borrower.as.mutation(api.requests.create, { toolId, ...window(1, 5) }));
    expect(tooLong).toMatchObject({ reason: "TOO_LONG" });

    const longMsg = await errorData(borrower.as.mutation(api.requests.create, { toolId, ...window(), message: "x".repeat(501) }));
    expect(longMsg.code).toBe("INVALID_INPUT");
  });

  it("prevents duplicate pending requests from the same borrower", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(t, owner);
    await borrower.as.mutation(api.requests.create, { toolId, ...window(1, 1) });
    const dup = await errorData(borrower.as.mutation(api.requests.create, { toolId, ...window(5, 1) }));
    expect(dup.code).toBe("DUPLICATE");
  });

  it("allows multiple borrowers to request, and approval auto-declines only overlapping ones", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const a = await createUser(t, "alice");
    const b = await createUser(t, "bob");
    const c = await createUser(t, "carol");
    const toolId = await createTool(t, owner);

    const reqA = await a.as.mutation(api.requests.create, { toolId, ...window(1, 2) });
    const reqB = await b.as.mutation(api.requests.create, { toolId, ...window(2, 2) }); // overlaps A
    const reqC = await c.as.mutation(api.requests.create, { toolId, ...window(10, 1) }); // separate
    expect((await owner.as.query(api.requests.incoming, {})).length).toBe(3);

    await owner.as.mutation(api.requests.approve, { requestId: reqA });
    await drain(t);
    const bMine = await b.as.query(api.requests.mine, {});
    expect(bMine[0]).toMatchObject({ id: reqB, status: "DECLINED" });
    expect(bMine[0]!.declineReason).toContain("booked");
    const pending = await owner.as.query(api.requests.incoming, {});
    expect(pending.map((r) => r.id)).toEqual([reqC]);

    // The approved window is now blocked for new requests …
    const blocked = await errorData(b.as.mutation(api.requests.create, { toolId, ...window(1.5, 1) }));
    expect(blocked.code).toBe("CONFLICT");
    // … but back-to-back bookings are fine, and the tool is still discoverable (RESERVED).
    const tool = await c.as.query(api.tools.get, { toolId });
    expect(tool!.status).toBe("RESERVED");
    expect(tool!.bookedRanges).toHaveLength(1);
  });

  it("rejects approving a request whose dates collide with a loan approved in the meantime", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const a = await createUser(t, "alice");
    const b = await createUser(t, "bob");
    const toolId = await createTool(t, owner);
    const reqA = await a.as.mutation(api.requests.create, { toolId, ...window(1, 2) });
    const reqB = await b.as.mutation(api.requests.create, { toolId, ...window(2, 2) });
    // Simulate a race: B's request was not auto-declined (e.g. created concurrently).
    await owner.as.mutation(api.requests.approve, { requestId: reqA });
    await t.run(async (ctx) => {
      await ctx.db.patch(reqB, { status: "PENDING", declineReason: undefined });
    });
    const err = await errorData(owner.as.mutation(api.requests.approve, { requestId: reqB }));
    expect(err.code).toBe("CONFLICT");
  });

  it("cannot request unlisted tools; unlisting declines pending requests", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(t, owner);
    const requestId = await borrower.as.mutation(api.requests.create, { toolId, ...window() });
    await owner.as.mutation(api.tools.setListed, { toolId, listed: false });
    expect((await borrower.as.query(api.requests.mine, {}))[0]).toMatchObject({ id: requestId, status: "DECLINED" });
    expect((await errorData(borrower.as.mutation(api.requests.create, { toolId, ...window() }))).code).toBe("UNAVAILABLE");
    expect((await owner.as.query(api.tools.mine, {}))[0]!.status).toBe("UNAVAILABLE");
    await owner.as.mutation(api.tools.setListed, { toolId, listed: true });
    expect((await owner.as.query(api.tools.mine, {}))[0]!.status).toBe("AVAILABLE");
  });

  it("expires pending requests once the pickup time passes", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(t, owner);
    const requestId = await borrower.as.mutation(api.requests.create, { toolId, ...window() });
    await t.run((ctx) => ctx.db.patch(requestId, { pickupAt: Date.now() - TIME.hour }));
    const n = await t.mutation(internal.scheduled.expireStaleRequests, {});
    expect(n).toBe(1);
    expect((await borrower.as.query(api.requests.mine, {}))[0]).toMatchObject({ status: "EXPIRED", tab: "CANCELLED" });
    expect((await owner.as.query(api.tools.mine, {}))[0]!.status).toBe("AVAILABLE");
  });

  it("borrower can withdraw a pending request", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(t, owner);
    const requestId = await borrower.as.mutation(api.requests.create, { toolId, ...window() });
    await borrower.as.mutation(api.requests.cancel, { requestId });
    expect((await owner.as.query(api.requests.incoming, {})).length).toBe(0);
    expect((await errorData(borrower.as.mutation(api.requests.cancel, { requestId }))).code).toBe("INVALID_STATE");
  });

  it("does not allow deleting a listing with an open loan", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(t, owner);
    const requestId = await borrower.as.mutation(api.requests.create, { toolId, ...window() });
    await owner.as.mutation(api.requests.approve, { requestId });
    expect((await errorData(owner.as.mutation(api.tools.remove, { toolId }))).code).toBe("INVALID_STATE");
  });
});
