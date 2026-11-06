/**
 * Redact values that must never be persisted in logs or error records
 * (emails, tokens, signatures, long digit runs such as OTPs or phone numbers,
 * precise coordinates).
 */
export function redactSensitive(text: string, max = 500): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
    .replace(/sha256=[a-f0-9]+/gi, "sha256=[redacted]")
    .replace(/\b(secret|password|passwd|token|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1$2[redacted]")
    .replace(/-?\d{1,3}\.\d{4,}/g, "[coord]")
    .replace(/\b\d{6,}\b/g, "[number]")
    .slice(0, max);
}
