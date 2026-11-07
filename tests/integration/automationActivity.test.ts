import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { approvedLoan, createUser, setup } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("loan automation activity (bonus)", () => {
  it("lists the loan's notification events for its participants only, without sensitive fields", async () => {
    // No n8n configured: events are recorded and end up SKIPPED, which is still activity to show.
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const stranger = await createUser(t, "stranger");
    const { loanId } = await approvedLoan(t, owner, borrower);

    const forOwner = await owner.as.query(api.loans.automationActivity, { loanId });
    const forBorrower = await borrower.as.query(api.loans.automationActivity, { loanId });
    expect(forOwner!.length).toBeGreaterThan(0);
    // Request created (→ owner) and approved (→ borrower) are both linked to this loan via its request.
    const types = forOwner!.filter((i) => i.kind === "notification").map((i) => (i.kind === "notification" ? i.eventType : ""));
    expect(types).toEqual(expect.arrayContaining(["borrow_request.created", "borrow_request.approved"]));
    expect(forBorrower).toEqual(forOwner);

    expect(await stranger.as.query(api.loans.automationActivity, { loanId })).toBeNull();
    const json = JSON.stringify(forOwner);
    expect(json).not.toContain("@example.com");
    expect(json).not.toContain("payload");
  });
});
