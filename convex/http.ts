/**
 * Authenticated HTTP endpoints for n8n.
 *
 * Every request must carry:
 *   x-lendloop-timestamp: unix seconds (±5 min)
 *   x-lendloop-nonce:     unique per request (replays rejected)
 *   x-lendloop-signature: sha256=HMAC_SHA256(AUTOMATION_INBOUND_SECRET, `${ts}.${nonce}.${rawBody}`)
 *
 * Bodies are validated with strict schemas. Responses never echo secrets.
 */
import { httpRouter } from "convex/server";
import { z } from "zod";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import { NONCE_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyRequestSignature } from "./lib/crypto";
import { reminderPeriod } from "./lib/rules";

const MAX_BODY_BYTES = 64 * 1024;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function signedEndpoint<S extends z.ZodType>(
  route: string,
  schema: S,
  handler: (ctx: ActionCtx, body: z.infer<S>) => Promise<Response>,
) {
  return httpAction(async (ctx, request) => {
    const secret = process.env.AUTOMATION_INBOUND_SECRET;
    if (!secret || secret.length < 32) return json({ error: "not_configured" }, 503);

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);

    const nonce = request.headers.get(NONCE_HEADER);
    const check = await verifyRequestSignature({
      secret,
      body: raw,
      signature: request.headers.get(SIGNATURE_HEADER),
      timestamp: request.headers.get(TIMESTAMP_HEADER),
      nonce,
      nowMs: Date.now(),
    });
    if (!check.ok) {
      console.warn("Rejected automation request", { route, reason: check.reason });
      return json({ error: "unauthorized" }, 401);
    }
    if (!nonce || nonce.length > 100) return json({ error: "unauthorized" }, 401);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw || "{}");
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return json({ error: "invalid_payload", issues: result.error.issues.map((i) => i.path.join(".")) }, 400);
    }

    const { replay } = await ctx.runMutation(internal.automation.claimNonce, { nonce, route });
    if (replay) return json({ error: "replayed" }, 409);

    return handler(ctx, result.data);
  });
}

const eventId = z.string().regex(/^evt_[A-Za-z0-9]+$/).max(100);
const executionId = z.string().max(100).optional();
const period = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const convexId = z.string().regex(/^[A-Za-z0-9]+$/).max(64);

const http = httpRouter();

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => json({ ok: true, service: "lendloop-convex" })),
});

http.route({
  path: "/automation/events/claim",
  method: "POST",
  handler: signedEndpoint("events.claim", z.strictObject({ eventId, executionId }), async (ctx, body) =>
    json(await ctx.runMutation(internal.automation.claimEvent, body)),
  ),
});

http.route({
  path: "/automation/events/report",
  method: "POST",
  handler: signedEndpoint(
    "events.report",
    z.strictObject({
      eventId,
      executionId,
      result: z.enum(["SENT", "MOCKED", "FAILED", "SKIPPED"]),
      error: z.string().max(1000).optional(),
    }),
    async (ctx, body) => json(await ctx.runMutation(internal.automation.reportEventDelivery, body)),
  ),
});

http.route({
  path: "/automation/overdue/candidates",
  method: "POST",
  handler: signedEndpoint(
    "overdue.candidates",
    z.strictObject({ period: period.optional(), limit: z.number().int().min(1).max(200).optional(), executionId }),
    async (ctx, body) => {
      const p = body.period ?? reminderPeriod(Date.now());
      const items = await ctx.runQuery(internal.automation.overdueCandidates, { period: p, limit: body.limit ?? 100 });
      return json({ period: p, items });
    },
  ),
});

http.route({
  path: "/automation/reminders/claim",
  method: "POST",
  handler: signedEndpoint(
    "reminders.claim",
    z.strictObject({ loanId: convexId, period, executionId }),
    async (ctx, body) => json(await ctx.runMutation(internal.automation.claimReminder, body)),
  ),
});

http.route({
  path: "/automation/reminders/report",
  method: "POST",
  handler: signedEndpoint(
    "reminders.report",
    z.strictObject({
      loanId: convexId,
      period,
      result: z.enum(["SENT", "MOCKED", "FAILED"]),
      error: z.string().max(1000).optional(),
      executionId,
    }),
    async (ctx, body) => json(await ctx.runMutation(internal.automation.reportReminder, body)),
  ),
});

http.route({
  path: "/automation/runs",
  method: "POST",
  handler: signedEndpoint(
    "runs.record",
    z.strictObject({
      workflowName: z.string().min(1).max(100),
      executionId,
      processed: z.number().int().min(0),
      sent: z.number().int().min(0),
      skipped: z.number().int().min(0),
      failed: z.number().int().min(0),
      startedAt: z.number().int().optional(),
    }),
    async (ctx, body) => json(await ctx.runMutation(internal.automation.recordRun, body)),
  ),
});

http.route({
  path: "/automation/errors",
  method: "POST",
  handler: signedEndpoint(
    "errors.record",
    z.strictObject({
      workflowName: z.string().min(1).max(100),
      executionId,
      failedNode: z.string().max(100).optional(),
      errorMessage: z.string().min(1).max(2000),
      relatedEventId: z.string().max(100).optional(),
      occurredAt: z.number().int().optional(),
    }),
    async (ctx, body) => {
      const { ok } = await ctx.runMutation(internal.automation.recordFailure, body);
      return json({ ok });
    },
  ),
});

export default http;
