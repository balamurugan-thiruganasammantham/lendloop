import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { activeLoan, approvedLoan, createTool, createUser, drain, errorData, latestCodeFor, setup, uploadImage, window } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function wrong(code: string) {
  return code === "000000" ? "111111" : "000000";
}

describe("hand-over OTP security", () => {
  it("never lets the borrower verify their own collection", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await approvedLoan(t, owner, borrower);
    const code = await latestCodeFor(t, borrower.userId);
    const err = await errorData(borrower.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code }));
    expect(err.code).toBe("FORBIDDEN");
    expect((await owner.as.query(api.loans.get, { loanId }))!.status).toBe("COLLECTION_OTP_PENDING");
  });

  it("does not show codes to the owner", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await approvedLoan(t, owner, borrower);
    const err = await errorData(owner.as.action(api.otpActions.requestCode, { loanId, purpose: "COLLECTION" }));
    expect(err.code).toBe("FORBIDDEN");
    const ownerMail = await t.run((ctx) => ctx.db.query("devMailbox").withIndex("by_user", (q) => q.eq("userId", owner.userId)).collect());
    expect(ownerMail).toHaveLength(0);
  });

  it("counts wrong attempts, locks after five, and requires a new code", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await approvedLoan(t, owner, borrower);
    const code = await latestCodeFor(t, borrower.userId);

    for (let i = 1; i <= 4; i++) {
      const err = await errorData(owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code: wrong(code) }));
      expect(err).toMatchObject({ code: "OTP_INVALID", attemptsRemaining: 5 - i });
    }
    const fifth = await errorData(owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code: wrong(code) }));
    expect(fifth.code).toBe("OTP_LOCKED");
    // Even the right code is rejected once locked.
    const locked = await errorData(owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code }));
    expect(locked.code).toBe("OTP_LOCKED");

    const fresh = await borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "COLLECTION" });
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code: fresh.code });
    expect((await owner.as.query(api.loans.get, { loanId }))!.status).toBe("ACTIVE_LOAN");
  });

  it("rejects expired codes", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await approvedLoan(t, owner, borrower);
    const code = await latestCodeFor(t, borrower.userId);
    await t.run(async (ctx) => {
      const otp = await ctx.db.query("otpVerifications").withIndex("by_loan", (q) => q.eq("loanId", loanId)).first();
      await ctx.db.patch(otp!._id, { expiresAt: Date.now() - 1000 });
    });
    const err = await errorData(owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code }));
    expect(err.code).toBe("OTP_EXPIRED");
    expect((await owner.as.query(api.loans.get, { loanId }))!.otp.collection!.expired).toBe(true);
  });

  it("invalidates the previous code when a new one is issued", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await approvedLoan(t, owner, borrower);
    const first = await latestCodeFor(t, borrower.userId);
    const second = await borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "COLLECTION" });
    if (first !== second.code) {
      const err = await errorData(owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code: first }));
      expect(err.code).toBe("OTP_INVALID");
    }
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code: second.code });
    expect((await owner.as.query(api.loans.get, { loanId }))!.status).toBe("ACTIVE_LOAN");
  });

  it("does not let a delayed system code replace one the borrower just requested", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await activeLoan(t, owner, borrower);
    const photo = await uploadImage(t, borrower);
    await borrower.as.mutation(api.loans.requestReturn, { loanId, photoIds: [photo] });
    await owner.as.mutation(api.loans.confirmReturnReady, { loanId });
    // Borrower asks for a code before the scheduled issuance has run…
    const onScreen = await borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "RETURN" });
    await drain(t);
    // …and that code still works afterwards.
    await owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "RETURN", code: onScreen.code });
    expect((await owner.as.query(api.loans.get, { loanId }))!.status).toBe("COMPLETED");
  });

  it("rate limits code issuance", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await approvedLoan(t, owner, borrower);
    for (let i = 0; i < 6; i++) await borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "COLLECTION" });
    const err = await errorData(borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "COLLECTION" }));
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("validates code format before hashing and refuses codes at the wrong stage", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await approvedLoan(t, owner, borrower);
    expect((await errorData(owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "COLLECTION", code: "12ab" }))).code).toBe("INVALID_INPUT");
    expect((await errorData(owner.as.action(api.otpActions.verifyCode, { loanId, purpose: "RETURN", code: "123456" }))).code).toBe("INVALID_STATE");
    expect((await errorData(borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "RETURN" }))).code).toBe("INVALID_STATE");
  });

  it("fails safely when the OTP pepper is not configured", async () => {
    const t = setup({ OTP_PEPPER: "" });
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const toolId = await createTool(t, owner);
    const requestId = await borrower.as.mutation(api.requests.create, { toolId, ...window() });
    const loanId = await owner.as.mutation(api.requests.approve, { requestId });
    await drain(t);
    // No code could be issued, so the loan stays APPROVED and nothing was stored.
    expect((await owner.as.query(api.loans.get, { loanId }))!.status).toBe("APPROVED");
    expect(await t.run((ctx) => ctx.db.query("otpVerifications").collect())).toHaveLength(0);
    const err = await errorData(borrower.as.action(api.otpActions.requestCode, { loanId, purpose: "COLLECTION" }));
    expect(err.code).toBe("CONFIG");
  });
});
