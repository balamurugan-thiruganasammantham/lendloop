/**
 * Cryptographic helpers built on the Web Crypto API (available in Convex
 * actions, HTTP actions, Node 20+ and the test runtime).
 *
 * IMPORTANT: Only call these from actions / HTTP actions. Queries and
 * mutations run in a deterministic environment and must not generate secrets.
 */

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

export async function sha256Hex(message: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(message)));
}

/** Constant-time string comparison (length is not secret here: both sides are fixed-length hex). */
export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Cryptographically secure numeric OTP using rejection sampling to avoid
 * modulo bias.
 */
export function generateNumericOtp(digits = 6): string {
  if (digits < 4 || digits > 10) throw new Error("OTP length must be between 4 and 10 digits");
  const max = 10 ** digits;
  // Largest multiple of `max` that fits in 2^32, to keep the distribution uniform.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const n = buf[0]!;
    if (n < limit) return String(n % max).padStart(digits, "0");
  }
}

/**
 * OTP hashes are keyed with a server-side pepper and bound to the loan and
 * purpose, so a hash leaked from one loan cannot be replayed against another
 * and offline brute force requires the pepper.
 */
export async function hashOtp(pepper: string, loanId: string, purpose: string, code: string): Promise<string> {
  return hmacSha256Hex(pepper, `otp:v1:${loanId}:${purpose}:${code}`);
}

export function normalizeOtpInput(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const NONCE_HEADER = "x-lendloop-nonce";
export const EVENT_ID_HEADER = "x-lendloop-event-id";

/** Default tolerance for clock skew / replay window. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/** Signature over `${timestamp}.${nonce}.${body}`; header format `sha256=<hex>`. */
export async function signRequest(secret: string, timestamp: number, nonce: string, body: string): Promise<string> {
  return `sha256=${await hmacSha256Hex(secret, `${timestamp}.${nonce}.${body}`)}`;
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature" };

export async function verifyRequestSignature(params: {
  secret: string;
  body: string;
  signature: string | null;
  timestamp: string | null;
  nonce: string | null;
  nowMs: number;
  toleranceSeconds?: number;
}): Promise<SignatureCheck> {
  const { secret, body, signature, timestamp, nonce, nowMs } = params;
  const tolerance = params.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (!signature || !timestamp || !nonce) return { ok: false, reason: "missing_headers" };
  if (!/^\d{9,11}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };
  const ts = Number(timestamp);
  if (Math.abs(nowMs / 1000 - ts) > tolerance) return { ok: false, reason: "stale_timestamp" };
  const expected = await signRequest(secret, ts, nonce, body);
  return timingSafeEqual(expected, signature) ? { ok: true } : { ok: false, reason: "bad_signature" };
}
