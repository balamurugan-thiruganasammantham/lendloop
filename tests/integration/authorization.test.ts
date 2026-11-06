import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { activeLoan, approvedLoan, createTool, createUser, errorData, setup, uploadImage, window } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("authentication & roles", () => {
  it("rejects anonymous writes and returns nothing private to anonymous reads", async () => {
    const t = setup();
    expect((await errorData(t.mutation(api.users.ensureCurrent, {}))).code).toBe("UNAUTHENTICATED");
    expect((await errorData(t.mutation(api.files.generateUploadUrl, {}))).code).toBe("UNAUTHENTICATED");
    expect(await t.query(api.users.me, {})).toBeNull();
    expect(await t.query(api.loans.listActive, {})).toEqual([]);
    expect((await errorData(t.query(api.tools.discover, {}))).code).toBe("UNAUTHENTICATED");
  });

  it("creates every account as USER and never accepts client role input", async () => {
    const t = setup();
    const u = await createUser(t, "mallory");
    const me = await u.as.query(api.users.me, {});
    expect(me).toMatchObject({ role: "USER", status: "ACTIVE", trustedLender: false });
    // Calling ensureCurrent again is idempotent and cannot escalate.
    await u.as.mutation(api.users.ensureCurrent, {});
    expect((await u.as.query(api.users.me, {}))!.role).toBe("USER");
    // No public function exposes role assignment.
    expect(Object.keys(api.admin)).not.toContain("setRoleByEmail");
  });

  it("only allows admins to use admin functions (checked server-side)", async () => {
    const t = setup();
    const user = await createUser(t, "user");
    const other = await createUser(t, "other");
    for (const call of [
      user.as.query(api.admin.overview, {}),
      user.as.query(api.admin.users, {}),
      user.as.query(api.admin.auditLogs, {}),
      user.as.mutation(api.admin.setTrusted, { userId: other.userId, trusted: true }),
      user.as.mutation(api.admin.setStatus, { userId: other.userId, status: "SUSPENDED", reason: "nope nope" }),
    ]) {
      expect((await errorData(call)).code).toBe("FORBIDDEN");
    }

    await t.mutation(internal.admin.setRoleByEmail, { email: "user@example.com", role: "ADMIN" });
    const overview = await user.as.query(api.admin.overview, {});
    expect(overview.users).toBe(2);
    await user.as.mutation(api.admin.setTrusted, { userId: other.userId, trusted: true });
    expect((await other.as.query(api.users.me, {}))!.trustedLender).toBe(true);
    const audit = await user.as.query(api.admin.auditLogs, {});
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["admin.role_changed", "admin.trusted_granted"]));
    // Admins cannot suspend themselves.
    expect((await errorData(user.as.mutation(api.admin.setStatus, { userId: user.userId, status: "SUSPENDED", reason: "test test" }))).code).toBe("FORBIDDEN");
  });

  it("blocks suspended users from writing and hides their listings", async () => {
    const t = setup();
    const admin = await createUser(t, "admin");
    await t.mutation(internal.admin.setRoleByEmail, { email: "admin@example.com", role: "ADMIN" });
    const owner = await createUser(t, "owner");
    const viewer = await createUser(t, "viewer");
    const toolId = await createTool(t, owner);
    await admin.as.mutation(api.admin.setStatus, { userId: owner.userId, status: "SUSPENDED", reason: "Spam listings" });

    const disc = await viewer.as.query(api.tools.discover, { center: { lat: 12.97, lng: 77.64 }, radiusKm: 5 });
    expect(disc.items.map((i) => i.id)).not.toContain(toolId);
    expect((await errorData(owner.as.mutation(api.tools.setListed, { toolId, listed: false }))).code).toBe("ACCOUNT_SUSPENDED");
    expect((await errorData(viewer.as.mutation(api.requests.create, { toolId, ...window() }))).code).toBe("UNAVAILABLE");

    await admin.as.mutation(api.admin.setStatus, { userId: owner.userId, status: "ACTIVE" });
    const again = await viewer.as.query(api.tools.discover, { center: { lat: 12.97, lng: 77.64 }, radiusKm: 5 });
    expect(again.items.map((i) => i.id)).toContain(toolId);
  });
});

describe("ownership & IDOR protection", () => {
  it("prevents editing, deleting or toggling someone else's listing", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const attacker = await createUser(t, "attacker");
    const toolId = await createTool(t, owner);
    const img = await uploadImage(t, attacker);
    expect((await errorData(attacker.as.mutation(api.tools.setListed, { toolId, listed: false }))).code).toBe("NOT_FOUND");
    expect((await errorData(attacker.as.mutation(api.tools.remove, { toolId }))).code).toBe("NOT_FOUND");
    expect(
      (
        await errorData(
          attacker.as.mutation(api.tools.update, {
            toolId,
            name: "Hacked",
            category: "OTHER",
            description: "Hacked description here",
            condition: "FAIR",
            imageIds: [img],
            pickupArea: "Elsewhere",
            pickupLocation: { lat: 0, lng: 0 },
            maxLoanDays: 3,
          }),
        )
      ).code,
    ).toBe("NOT_FOUND");
    expect(await attacker.as.query(api.tools.getForEdit, { toolId })).toBeNull();
  });

  it("does not let a user attach another user's uploaded file", async () => {
    const t = setup();
    const victim = await createUser(t, "victim");
    const attacker = await createUser(t, "attacker");
    const victimImage = await uploadImage(t, victim);
    expect((await errorData(attacker.as.mutation(api.files.registerUpload, { storageId: victimImage }))).code).toBe("FORBIDDEN");
    const err = await errorData(
      attacker.as.mutation(api.tools.create, {
        name: "Stolen photo",
        category: "OTHER",
        description: "Using someone else's image",
        condition: "GOOD",
        imageIds: [victimImage],
        pickupArea: "Somewhere",
        pickupLocation: { lat: 12.9, lng: 77.6 },
        maxLoanDays: 2,
      }),
    );
    expect(err.code).toBe("INVALID_INPUT");
  });

  it("hides loans and their exact location from non-participants", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const stranger = await createUser(t, "stranger");
    const { loanId, requestId } = await approvedLoan(t, owner, borrower);
    expect(await stranger.as.query(api.loans.get, { loanId })).toBeNull();
    expect((await errorData(stranger.as.mutation(api.loans.cancel, { loanId }))).code).toBe("NOT_FOUND");
    expect((await errorData(stranger.as.mutation(api.requests.decline, { requestId }))).code).toBe("NOT_FOUND");
    expect((await errorData(stranger.as.action(api.otpActions.requestCode, { loanId, purpose: "COLLECTION" }))).code).toBe("NOT_FOUND");
    expect((await errorData(stranger.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code: "123456" }))).code).toBe("NOT_FOUND");
    // The borrower cannot approve/decline their own request.
    expect((await errorData(borrower.as.mutation(api.requests.decline, { requestId }))).code).toBe("NOT_FOUND");
  });

  it("enforces role-specific loan actions", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await activeLoan(t, owner, borrower);
    const photo = await uploadImage(t, owner);
    // The owner cannot start the borrower's return.
    expect((await errorData(owner.as.mutation(api.loans.requestReturn, { loanId, photoIds: [photo] }))).code).toBe("NOT_FOUND");
    // The borrower cannot confirm the return or report damage.
    expect((await errorData(borrower.as.mutation(api.loans.confirmReturnReady, { loanId }))).code).toBe("NOT_FOUND");
    expect(
      (await errorData(borrower.as.mutation(api.loans.reportDamage, { loanId, description: "Fake damage report", evidenceIds: [] }))).code,
    ).toBe("NOT_FOUND");
    // Active loans cannot be cancelled.
    expect((await errorData(owner.as.mutation(api.loans.cancel, { loanId }))).code).toBe("INVALID_STATE");
    // Not-returned reports are only possible after the agreed return time.
    expect((await errorData(owner.as.mutation(api.loans.reportNotReturned, { loanId, details: "Never came back to me" }))).code).toBe(
      "INVALID_STATE",
    );
  });

  it("restricts feedback to participants of completed loans", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const stranger = await createUser(t, "stranger");
    const { loanId } = await activeLoan(t, owner, borrower);
    expect((await errorData(borrower.as.mutation(api.feedback.submit, { loanId, rating: 5, tags: [] }))).code).toBe("INVALID_STATE");
    expect((await errorData(stranger.as.mutation(api.feedback.submit, { loanId, rating: 1, tags: [] }))).code).toBe("NOT_FOUND");
  });

  it("only lets a review's subject report it, once", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const stranger = await createUser(t, "stranger");
    const { loanId } = await activeLoan(t, owner, borrower);
    const photo = await uploadImage(t, borrower);
    await borrower.as.mutation(api.loans.requestReturn, { loanId, photoIds: [photo] });
    await owner.as.mutation(api.loans.confirmReturnReady, { loanId });
    const { code } = await borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "RETURN" });
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "RETURN", code });
    const fbId = await owner.as.mutation(api.feedback.submit, { loanId, rating: 1, comment: "Terrible", tags: ["POOR_COMMUNICATION"] });

    expect((await errorData(stranger.as.mutation(api.feedback.report, { feedbackId: fbId, reason: "This is not fair at all" }))).code).toBe("NOT_FOUND");
    await borrower.as.mutation(api.feedback.report, { feedbackId: fbId, reason: "This review is retaliatory and false" });
    expect((await errorData(borrower.as.mutation(api.feedback.report, { feedbackId: fbId, reason: "Reporting again here" }))).code).toBe("DUPLICATE");

    // Admin hides it; the rating stops counting.
    const admin = await createUser(t, "admin");
    await t.mutation(internal.admin.setRoleByEmail, { email: "admin@example.com", role: "ADMIN" });
    const [report] = await admin.as.query(api.admin.reports, {});
    expect(report!.feedback!.rating).toBe(1);
    await admin.as.mutation(api.admin.reviewReport, { reportId: report!.id, action: "HIDE_FEEDBACK", note: "Violates guidelines" });
    const rep = await stranger.as.query(api.users.reputation, { userId: borrower.userId });
    expect(rep!.reputation.reviewCount).toBe(0);
    expect(rep!.feedback).toHaveLength(0);
  });
});
