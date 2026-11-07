import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { toClientError } from "@/lib/errors";

describe("toClientError", () => {
  const payload = { code: "OTP_INVALID", message: "That code is incorrect.", attemptsRemaining: 4 };

  it("surfaces ConvexError payloads", () => {
    expect(toClientError(new ConvexError(payload))).toMatchObject({ code: "OTP_INVALID", message: "That code is incorrect." });
  });

  it("also recognises payloads by shape (errors re-thrown from actions)", () => {
    const err = Object.assign(new Error("[CONVEX A(otpActions:verifyCode)] Uncaught ConvexError"), { data: payload });
    expect(toClientError(err)).toMatchObject({ code: "OTP_INVALID", message: "That code is incorrect.", data: { attemptsRemaining: 4 } });
    const jsonErr = Object.assign(new Error("x"), { data: JSON.stringify(payload) });
    expect(toClientError(jsonErr).code).toBe("OTP_INVALID");
  });

  it("never leaks unexpected errors", () => {
    expect(toClientError(new Error("db exploded at row 42")).message).toBe("Something went wrong on our side. Please try again.");
  });
});
