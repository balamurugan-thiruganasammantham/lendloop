import { describe, expect, it } from "vitest";
import {
  generateNumericOtp,
  hashOtp,
  hmacSha256Hex,
  normalizeOtpInput,
  signRequest,
  timingSafeEqual,
  verifyRequestSignature,
} from "@convex/lib/crypto";
import { sanitizeAuditMeta } from "@convex/lib/audit";
import { redactSensitive } from "@convex/lib/sanitize";

describe("OTP generation", () => {
  it("produces fixed-length numeric codes", () => {
    for (let i = 0; i < 200; i++) expect(generateNumericOtp(6)).toMatch(/^\d{6}$/);
  });

  it("is not trivially repetitive", () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateNumericOtp(6)));
    expect(codes.size).toBeGreaterThan(490);
  });

  it("spreads leading digits roughly uniformly", () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 5000; i++) counts[Number(generateNumericOtp(6)[0])]++;
    for (const c of counts) {
      expect(c).toBeGreaterThan(350);
      expect(c).toBeLessThan(650);
    }
  });

  it("rejects unsafe lengths", () => {
    expect(() => generateNumericOtp(3)).toThrow();
  });
});

describe("OTP hashing", () => {
  const pepper = "p".repeat(64);
  it("is deterministic for the same inputs", async () => {
    expect(await hashOtp(pepper, "loan1", "COLLECTION", "123456")).toBe(await hashOtp(pepper, "loan1", "COLLECTION", "123456"));
  });
  it("binds the hash to loan, purpose and pepper", async () => {
    const h = await hashOtp(pepper, "loan1", "COLLECTION", "123456");
    expect(await hashOtp(pepper, "loan2", "COLLECTION", "123456")).not.toBe(h);
    expect(await hashOtp(pepper, "loan1", "RETURN", "123456")).not.toBe(h);
    expect(await hashOtp("q".repeat(64), "loan1", "COLLECTION", "123456")).not.toBe(h);
    expect(h).not.toContain("123456");
  });
  it("normalises user input", () => {
    expect(normalizeOtpInput(" 123-456 ")).toBe("123456");
  });
});

describe("HMAC request signatures", () => {
  const secret = "s".repeat(64);
  const body = JSON.stringify({ eventId: "evt_1", n: 1 });
  const now = Date.UTC(2026, 10, 5, 12, 0, 0);
  const ts = Math.floor(now / 1000);

  it("matches a reference HMAC-SHA256", async () => {
    // RFC 4231 test case 2.
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    );
  });

  it("accepts a valid signature", async () => {
    const signature = await signRequest(secret, ts, "nonce-1", body);
    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    await expect(
      verifyRequestSignature({ secret, body, signature, timestamp: String(ts), nonce: "nonce-1", nowMs: now }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects tampered bodies, nonces and wrong secrets", async () => {
    const signature = await signRequest(secret, ts, "nonce-1", body);
    const common = { secret, signature, timestamp: String(ts), nowMs: now };
    await expect(verifyRequestSignature({ ...common, body: body + " ", nonce: "nonce-1" })).resolves.toMatchObject({ ok: false, reason: "bad_signature" });
    await expect(verifyRequestSignature({ ...common, body, nonce: "nonce-2" })).resolves.toMatchObject({ ok: false });
    await expect(verifyRequestSignature({ ...common, secret: "x".repeat(64), body, nonce: "nonce-1" })).resolves.toMatchObject({ ok: false });
  });

  it("rejects stale or malformed timestamps and missing headers", async () => {
    const signature = await signRequest(secret, ts, "n", body);
    await expect(
      verifyRequestSignature({ secret, body, signature, timestamp: String(ts), nonce: "n", nowMs: now + 301_000 }),
    ).resolves.toMatchObject({ reason: "stale_timestamp" });
    await expect(
      verifyRequestSignature({ secret, body, signature, timestamp: "abc", nonce: "n", nowMs: now }),
    ).resolves.toMatchObject({ reason: "bad_timestamp" });
    await expect(
      verifyRequestSignature({ secret, body, signature: null, timestamp: String(ts), nonce: "n", nowMs: now }),
    ).resolves.toMatchObject({ reason: "missing_headers" });
  });

  it("timingSafeEqual compares correctly", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
  });
});

describe("log redaction", () => {
  it("removes emails, tokens, signatures, codes and coordinates", () => {
    const raw =
      'Failed for arun@example.com with Bearer abc.def.ghi sha256=deadbeef code 482913 at 12.971612,77.641249 secret="xyz"';
    const clean = redactSensitive(raw);
    expect(clean).not.toContain("arun@example.com");
    expect(clean).not.toContain("abc.def.ghi");
    expect(clean).not.toContain("deadbeef");
    expect(clean).not.toContain("482913");
    expect(clean).not.toContain("12.971612");
    expect(clean).not.toContain("xyz");
  });

  it("strips sensitive keys from audit metadata", () => {
    const meta = sanitizeAuditMeta({
      otpCode: "123456",
      lat: 1.23,
      pickup_lng: 77.1,
      email: "a@b.c",
      loanId: "x",
      attempts: 2,
      relatedEventId: "evt_1",
      translation: "kept",
    });
    expect(meta).toEqual({ loanId: "x", attempts: 2, relatedEventId: "evt_1", translation: "kept" });
  });
});
