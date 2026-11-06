import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import {
  approvedLoan,
  createTool,
  createUser,
  drain,
  errorData,
  latestCodeFor,
  setup,
  uploadImage,
  window,
} from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("full borrow → lend → return lifecycle", () => {
  it("runs end to end with OTP verification, live availability and two-sided feedback", async () => {
    const t = setup();
    const owner = await createUser(t, "arun", "Arun Kumar");
    const borrower = await createUser(t, "priya", "Priya Nair");

    // 1. Owner lists a tool.
    const toolId = await createTool(t, owner);
    const near = { lat: 12.97, lng: 77.64 };

    // 2. Borrower discovers it on the map (approximate distance).
    const found = await borrower.as.query(api.tools.discover, { center: near, radiusKm: 5 });
    expect(found.items.map((i) => i.id)).toContain(toolId);
    expect(found.items[0]!.distanceKm).toBeLessThan(1.5);
    expect(found.items[0]!.owner.name).toBe("Arun K.");

    // 3. Borrower requests it.
    const requestId = await borrower.as.mutation(api.requests.create, {
      toolId,
      ...window(1, 2),
      message: "Need it for shelves",
    });
    let mine = await borrower.as.query(api.requests.mine, {});
    expect(mine[0]).toMatchObject({ id: requestId, status: "PENDING", tab: "PENDING" });
    expect((await borrower.as.query(api.tools.get, { toolId }))!.status).toBe("PENDING_REQUEST");

    // 4. Owner is notified and sees borrower reputation.
    const ownerNotes = await owner.as.query(api.notifications.list, {});
    expect(ownerNotes[0]).toMatchObject({ type: "REQUEST_CREATED", requestId });
    const incoming = await owner.as.query(api.requests.incoming, {});
    expect(incoming[0]!.borrower!.reputation.verified.borrowingTotal).toBe(0);

    // 5. Owner approves; collection code is generated asynchronously.
    const loanId = await owner.as.mutation(api.requests.approve, { requestId });
    await drain(t);
    let loan = (await borrower.as.query(api.loans.get, { loanId }))!;
    expect(loan.status).toBe("COLLECTION_OTP_PENDING");
    expect(loan.pickup).toMatchObject({ lat: 12.97161, lng: 77.64125, address: "12 Secret Lane" });
    expect(loan.otp.collection).toMatchObject({ attemptsRemaining: 5, expired: false });
    expect((await borrower.as.query(api.notifications.list, {})).map((n) => n.type)).toEqual(
      expect.arrayContaining(["REQUEST_APPROVED", "PICKUP_OTP_GENERATED"]),
    );
    mine = await borrower.as.query(api.requests.mine, {});
    expect(mine[0]!.tab).toBe("APPROVED");

    // 6. Code is never stored in plaintext.
    const code = await latestCodeFor(t, borrower.userId);
    const otps = await t.run((ctx) => ctx.db.query("otpVerifications").collect());
    expect(JSON.stringify(otps)).not.toContain(code);
    const audit = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(JSON.stringify(audit)).not.toContain(code);

    // 7. Owner verifies pickup → loan active, tool leaves discovery.
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code });
    loan = (await owner.as.query(api.loans.get, { loanId }))!;
    expect(loan.status).toBe("ACTIVE_LOAN");
    expect(loan.collectedAt).not.toBeNull();
    const afterPickup = await borrower.as.query(api.tools.discover, { center: near, radiusKm: 5 });
    expect(afterPickup.items.map((i) => i.id)).not.toContain(toolId);
    expect((await owner.as.query(api.tools.mine, {}))[0]!.status).toBe("LENT");

    // 8. The code cannot be reused.
    const reuse = await errorData(owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code }));
    expect(reuse.code).toBe("INVALID_STATE");

    // 9. Borrower starts the return with a photo.
    const photo = await uploadImage(t, borrower);
    await borrower.as.mutation(api.loans.requestReturn, { loanId, photoIds: [photo], notes: "All good" });
    loan = (await owner.as.query(api.loans.get, { loanId }))!;
    expect(loan.status).toBe("RETURN_REQUESTED");
    expect(loan.returnSubmission!.photos).toHaveLength(1);
    expect(loan.actions).toEqual(expect.arrayContaining(["CONFIRM_RETURN", "REPORT_DAMAGE"]));
    expect((await owner.as.query(api.notifications.list, {}))[0]!.type).toBe("RETURN_REQUESTED");

    // 10. Owner confirms; return code goes to the borrower.
    await owner.as.mutation(api.loans.confirmReturnReady, { loanId });
    await drain(t);
    const fresh = await borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "RETURN" });
    expect(fresh.code).toMatch(/^\d{6}$/);

    // 11. Owner verifies the return → completed, tool available again.
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "RETURN", code: fresh.code });
    loan = (await borrower.as.query(api.loans.get, { loanId }))!;
    expect(loan.status).toBe("COMPLETED");
    expect(loan.actions).toContain("LEAVE_FEEDBACK");
    expect((await owner.as.query(api.tools.mine, {}))[0]!.status).toBe("AVAILABLE");
    expect((await borrower.as.query(api.tools.discover, { center: near, radiusKm: 5 })).items.map((i) => i.id)).toContain(toolId);
    // Exact location is no longer revealed once the loan is closed.
    expect(loan.pickup).toBeNull();

    // 12. Both parties leave feedback, once.
    await borrower.as.mutation(api.feedback.submit, { loanId, rating: 5, comment: "Great drill", tags: ["ITEM_AS_DESCRIBED"] });
    await owner.as.mutation(api.feedback.submit, { loanId, rating: 4, tags: ["RETURNED_ON_TIME"] });
    const dup = await errorData(owner.as.mutation(api.feedback.submit, { loanId, rating: 1, tags: [] }));
    expect(dup.code).toBe("DUPLICATE");

    const ownerRep = await borrower.as.query(api.users.reputation, { userId: owner.userId });
    expect(ownerRep!.reputation).toMatchObject({ averageRating: 5, reviewCount: 1 });
    expect(ownerRep!.reputation.verified.successfulLends).toBe(1);
    const borrowerRep = await owner.as.query(api.users.reputation, { userId: borrower.userId });
    expect(borrowerRep!.reputation.verified).toMatchObject({ successfulReturns: 1, borrowingTotal: 1, lateReturns: 0 });

    // 13. History lists the completed loan for both.
    expect((await borrower.as.query(api.loans.history, {}))[0]).toMatchObject({ id: loanId, status: "COMPLETED", feedbackGiven: true });
    expect(await owner.as.query(api.loans.listActive, {})).toHaveLength(0);

    // 14. Every transition is in the audit trail.
    const transitions = loan.timeline.filter((e) => e.action === "loan.status_changed").map((e) => e.toStatus);
    expect(transitions).toEqual([
      "COLLECTION_OTP_PENDING",
      "COLLECTED",
      "ACTIVE_LOAN",
      "RETURN_REQUESTED",
      "RETURN_VERIFICATION_PENDING",
      "RETURNED",
      "COMPLETED",
    ]);
  });

  it("declines with a reason and notifies the borrower", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(t, owner);
    const requestId = await borrower.as.mutation(api.requests.create, { toolId, ...window() });
    await owner.as.mutation(api.requests.decline, { requestId, reason: "Away that week" });
    const mine = await borrower.as.query(api.requests.mine, {});
    expect(mine[0]).toMatchObject({ status: "DECLINED", tab: "DECLINED", declineReason: "Away that week" });
    expect((await borrower.as.query(api.notifications.list, {}))[0]!.body).toContain("Away that week");
    expect((await owner.as.query(api.tools.mine, {}))[0]!.status).toBe("AVAILABLE");
    // Already processed requests cannot be approved.
    const again = await errorData(owner.as.mutation(api.requests.approve, { requestId }));
    expect(again.code).toBe("INVALID_STATE");
  });

  it("lets either party cancel before pickup, which frees the calendar", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId, toolId } = await approvedLoan(t, owner, borrower);
    expect((await owner.as.query(api.tools.mine, {}))[0]!.status).toBe("RESERVED");
    await borrower.as.mutation(api.loans.cancel, { loanId, reason: "Plans changed" });
    expect((await owner.as.query(api.loans.get, { loanId }))!.status).toBe("CANCELLED");
    expect((await owner.as.query(api.tools.mine, {}))[0]!.status).toBe("AVAILABLE");
    // Codes are invalidated.
    const otps = await t.run((ctx) => ctx.db.query("otpVerifications").collect());
    expect(otps.every((o) => o.status !== "ACTIVE")).toBe(true);
    // Mine tab shows it as cancelled.
    expect((await borrower.as.query(api.requests.mine, {}))[0]!.tab).toBe("CANCELLED");
    // A new request for the same dates is possible again.
    await borrower.as.mutation(api.requests.create, { toolId, ...window() });
  });

  it("marks loans overdue and counts late returns", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await approvedLoan(t, owner, borrower);
    const code = await latestCodeFor(t, borrower.userId);
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code });
    // Move the agreed return time into the past.
    await t.run((ctx) => ctx.db.patch(loanId, { returnBy: Date.now() - 3 * 60 * 60 * 1000 }));
    await t.mutation((await import("../../convex/_generated/api")).internal.scheduled.markOverdueLoans, {});
    let loan = (await borrower.as.query(api.loans.get, { loanId }))!;
    expect(loan).toMatchObject({ status: "OVERDUE", wasOverdue: true });
    expect(loan.actions).toContain("REQUEST_RETURN");

    const photo = await uploadImage(t, borrower);
    await borrower.as.mutation(api.loans.requestReturn, { loanId, photoIds: [photo] });
    await owner.as.mutation(api.loans.confirmReturnReady, { loanId });
    await drain(t);
    const { code: returnCode } = await borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "RETURN" });
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "RETURN", code: returnCode });
    loan = (await borrower.as.query(api.loans.get, { loanId }))!;
    expect(loan).toMatchObject({ status: "COMPLETED", lateReturn: true });
    const rep = await owner.as.query(api.users.reputation, { userId: borrower.userId });
    expect(rep!.reputation.verified.lateReturns).toBe(1);
  });
});
