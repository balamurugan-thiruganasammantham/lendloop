import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { activeLoan, createUser, drain, errorData, setup, uploadImage, type T, type TestUser } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function returnRequested(t: T, owner: TestUser, borrower: TestUser) {
  const ids = await activeLoan(t, owner, borrower);
  const photo = await uploadImage(t, borrower);
  await borrower.as.mutation(api.loans.requestReturn, { loanId: ids.loanId, photoIds: [photo], notes: "Back in its case" });
  return ids;
}

async function makeAdmin(t: T) {
  const admin = await createUser(t, "admin");
  await t.mutation(internal.admin.setRoleByEmail, { email: "admin@example.com", role: "ADMIN" });
  return admin;
}

describe("damage reports", () => {
  it("records evidence, notifies the borrower and keeps the tool out of discovery", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId, toolId } = await returnRequested(t, owner, borrower);

    const noEvidence = await errorData(owner.as.mutation(api.loans.reportDamage, { loanId, description: "Chuck is cracked badly", evidenceIds: [] }));
    expect(noEvidence.code).toBe("INVALID_INPUT");

    const evidence = await uploadImage(t, owner);
    await owner.as.mutation(api.loans.reportDamage, { loanId, description: "Chuck is cracked badly", evidenceIds: [evidence] });
    const loan = (await borrower.as.query(api.loans.get, { loanId }))!;
    expect(loan.status).toBe("DAMAGE_REPORTED");
    expect(loan.damageReports[0]).toMatchObject({ status: "OPEN", description: "Chuck is cracked badly" });
    expect(loan.damageReports[0]!.evidence).toHaveLength(1);
    expect(loan.actions).toContain("RESPOND_DAMAGE");
    expect((await borrower.as.query(api.notifications.list, {}))[0]!.type).toBe("DAMAGE_REPORTED");
    expect((await owner.as.query(api.tools.mine, {})).find((x) => x.id === toolId)!.status).toBe("RETURN_PENDING");

    // Unverified until acknowledged or upheld.
    let rep = await owner.as.query(api.users.reputation, { userId: borrower.userId });
    expect(rep!.reputation.verified.damageIncidentsConfirmed).toBe(0);
    expect(rep!.reputation.unverified.openDamageReports).toBe(1);

    await borrower.as.mutation(api.loans.respondToDamage, { reportId: loan.damageReports[0]!.id, response: "ACKNOWLEDGE" });
    rep = await owner.as.query(api.users.reputation, { userId: borrower.userId });
    expect(rep!.reputation.verified.damageIncidentsConfirmed).toBe(1);
    expect(rep!.reputation.unverified.openDamageReports).toBe(0);

    // Owner can then confirm the final return via OTP.
    await owner.as.mutation(api.loans.confirmReturnReady, { loanId });
    await drain(t);
    const { code } = await borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "RETURN" });
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "RETURN", code });
    expect((await owner.as.query(api.loans.get, { loanId }))!.status).toBe("COMPLETED");
  });

  it("escalates contested damage to a dispute that only an admin can resolve", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId, toolId } = await returnRequested(t, owner, borrower);
    const evidence = await uploadImage(t, owner);
    const reportId = await owner.as.mutation(api.loans.reportDamage, { loanId, description: "Scratched housing", evidenceIds: [evidence] });

    const tooShort = await errorData(borrower.as.mutation(api.loans.respondToDamage, { reportId, response: "CONTEST", statement: "no" }));
    expect(tooShort.code).toBe("INVALID_INPUT");
    await borrower.as.mutation(api.loans.respondToDamage, { reportId, response: "CONTEST", statement: "It was scratched when I collected it." });
    expect((await owner.as.query(api.loans.get, { loanId }))!.status).toBe("DISPUTED");

    // Owner cannot close a dispute themselves.
    expect((await errorData(owner.as.mutation(api.admin.resolveDispute, { loanId, outcome: "RETURNED", note: "I win" }))).code).toBe("FORBIDDEN");

    const admin = await makeAdmin(t);
    const disputes = await admin.as.query(api.admin.disputes, {});
    expect(disputes.map((d) => d.id)).toContain(loanId);
    await admin.as.mutation(api.admin.reviewDamage, { reportId, decision: "DISMISS", note: "Pre-existing per photos" });
    await admin.as.mutation(api.admin.resolveDispute, { loanId, outcome: "RETURNED", note: "Tool is back with the owner" });
    const loan = (await borrower.as.query(api.loans.get, { loanId }))!;
    expect(loan).toMatchObject({ status: "COMPLETED", disputeOutcome: "RETURNED" });
    expect(loan.damageReports[0]!.status).toBe("DISMISSED");
    expect((await owner.as.query(api.tools.mine, {})).find((x) => x.id === toolId)!.status).toBe("AVAILABLE");
    const rep = await owner.as.query(api.users.reputation, { userId: borrower.userId });
    expect(rep!.reputation.verified.damageIncidentsConfirmed).toBe(0);
    // Every admin decision is audited.
    const audit = await admin.as.query(api.admin.auditLogs, {});
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["admin.damage_reviewed", "loan.status_changed"]));
  });
});

describe("not returned", () => {
  it("opens a dispute, keeps the tool unavailable, and admin can confirm the loss", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId, toolId } = await activeLoan(t, owner, borrower);
    await t.run((ctx) => ctx.db.patch(loanId, { returnBy: Date.now() - 1000 }));

    await owner.as.mutation(api.loans.reportNotReturned, { loanId, details: "No reply for three days after the due date." });
    let loan = (await borrower.as.query(api.loans.get, { loanId }))!;
    expect(loan).toMatchObject({ status: "DISPUTED" });
    expect((await borrower.as.query(api.notifications.list, {}))[0]!.type).toBe("NOT_RETURNED_REPORTED");
    expect((await owner.as.query(api.tools.mine, {})).find((x) => x.id === toolId)!.status).toBe("RETURN_PENDING");

    // Unverified claim: shown separately from verified history.
    let rep = await owner.as.query(api.users.reputation, { userId: borrower.userId });
    expect(rep!.reputation.unverified.openNotReturnedReports).toBe(1);
    expect(rep!.reputation.verified.notReturnedConfirmed).toBe(0);

    const admin = await makeAdmin(t);
    await admin.as.mutation(api.admin.resolveDispute, { loanId, outcome: "NOT_RETURNED", note: "Borrower confirmed loss" });
    loan = (await borrower.as.query(api.loans.get, { loanId }))!;
    expect(loan).toMatchObject({ status: "COMPLETED", disputeOutcome: "NOT_RETURNED" });
    rep = await owner.as.query(api.users.reputation, { userId: borrower.userId });
    expect(rep!.reputation.verified.notReturnedConfirmed).toBe(1);
    // The owner no longer has the tool, so it stays unlisted until they relist it.
    const tool = (await owner.as.query(api.tools.mine, {})).find((x) => x.id === toolId)!;
    expect(tool).toMatchObject({ status: "UNAVAILABLE", isListed: false });
  });

  it("lets the owner resume verification if the tool turns up", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await returnRequested(t, owner, borrower);
    await owner.as.mutation(api.loans.reportNotReturned, { loanId, details: "Borrower did not show up at the agreed time." });
    await owner.as.mutation(api.loans.confirmReturnReady, { loanId });
    await drain(t);
    const { code } = await borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "RETURN" });
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "RETURN", code });
    expect((await owner.as.query(api.loans.get, { loanId }))!.status).toBe("COMPLETED");
  });
});
