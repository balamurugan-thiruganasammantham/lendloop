import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { signRequest, verifyRequestSignature } from "../../convex/lib/crypto";
import { reminderPeriod } from "../../convex/lib/rules";
import { activeLoan, createTool, createUser, drain, INBOUND_SECRET, N8N_SECRET, setup, window, type T } from "./helpers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function signedFetch(t: T, path: string, body: unknown, opts: { secret?: string; nonce?: string; ts?: number } = {}) {
  const raw = JSON.stringify(body);
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? crypto.randomUUID();
  const signature = await signRequest(opts.secret ?? INBOUND_SECRET, ts, nonce, raw);
  return t.fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lendloop-timestamp": String(ts),
      "x-lendloop-nonce": nonce,
      "x-lendloop-signature": signature,
    },
    body: raw,
  });
}

async function newRequestEvent(t: T) {
  const owner = await createUser(t, "owner", "Arun Kumar");
  const borrower = await createUser(t, "borrower", "Priya Nair");
  const toolId = await createTool(t, owner);
  await borrower.as.mutation(api.requests.create, { toolId, ...window() });
  const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
  return { owner, borrower, events };
}

describe("outbound delivery to n8n (Workflow A trigger)", () => {
  it("records SKIPPED (not silently dropped) when n8n is not configured", async () => {
    const t = setup();
    const { events } = await newRequestEvent(t);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: "borrow_request.created", status: "PENDING" });
    await drain(t);
    const after = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(after[0]).toMatchObject({ status: "SKIPPED" });
    expect(after[0]!.lastError).toContain("not configured");
  });

  it("sends a minimal HMAC-signed payload", async () => {
    const t = setup({ N8N_WEBHOOK_URL: "https://n8n.test/webhook/lendloop-events", N8N_WEBHOOK_SECRET: N8N_SECRET });
    const calls: { url: string; headers: Headers; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: new Headers(init.headers), body: String(init.body) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );
    await newRequestEvent(t);
    await drain(t);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    const payload = JSON.parse(call.body);
    expect(payload).toMatchObject({
      schemaVersion: 1,
      eventType: "borrow_request.created",
      recipient: { email: "owner@example.com", displayName: "Arun K." },
      subject: { toolName: "Cordless Drill", status: "PENDING" },
    });
    expect(payload.link).toBe("https://lendloop.test/incoming");
    // No coordinates, codes or private fields in the payload.
    expect(call.body).not.toMatch(/12\.97161|77\.64125|Secret Lane|tokenIdentifier|borrower@example.com/);
    const verified = await verifyRequestSignature({
      secret: N8N_SECRET,
      body: call.body,
      signature: call.headers.get("x-lendloop-signature"),
      timestamp: call.headers.get("x-lendloop-timestamp"),
      nonce: call.headers.get("x-lendloop-nonce"),
      nowMs: Date.now(),
    });
    expect(verified).toEqual({ ok: true });
    expect(call.headers.get("x-lendloop-event-id")).toBe(payload.eventId);
    const [ev] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(ev).toMatchObject({ status: "DELIVERED", attempts: 1 });
  });

  it("retries with backoff, then dead-letters and records a visible failure", async () => {
    const t = setup({ N8N_WEBHOOK_URL: "https://n8n.test/webhook/x", N8N_WEBHOOK_SECRET: N8N_SECRET });
    const fetchMock = vi.fn(async () => new Response("boom", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await newRequestEvent(t);
    await drain(t);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [ev] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(ev).toMatchObject({ status: "DEAD", attempts: 6 });
    expect(ev!.lastError).toContain("503");
    const failures = await t.run((ctx) => ctx.db.query("automationFailures").collect());
    expect(failures[0]).toMatchObject({ workflowName: "convex.outbound_delivery", status: "OPEN", relatedEventId: ev!.eventId });

    // Admin can retry once n8n is healthy again.
    const admin = await createUser(t, "admin");
    await t.mutation(internal.admin.setRoleByEmail, { email: "admin@example.com", role: "ADMIN" });
    const view = await admin.as.query(api.admin.automation, {});
    expect(view.problemEvents.map((e) => e.status)).toContain("DEAD");
    fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }));
    // The backoff drain above advanced the harness clock ~3h. Schedule the retry
    // under a fake clock that has caught up, so the test can fire it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.now() + 4 * 60 * 60 * 1000);
    await admin.as.mutation(api.admin.retryEvent, { automationEventId: ev!._id });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    const [after] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(after!.status).toBe("DELIVERED");
  });

  it("never forwards OTP notifications to n8n", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    await activeLoan(t, owner, borrower);
    const events = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    const types = events.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(["borrow_request.created", "borrow_request.approved", "loan.collected"]));
    expect(types.some((x) => x.includes("otp"))).toBe(false);
    expect(JSON.stringify(events)).not.toMatch(/code is|\b\d{6}\b/);
  });
});

describe("signed inbound endpoints (n8n → Convex)", () => {
  it("rejects bad signatures, stale timestamps, replays and invalid payloads", async () => {
    const t = setup();
    const { events } = await newRequestEvent(t);
    const eventId = events[0]!.eventId;

    expect((await signedFetch(t, "/automation/events/claim", { eventId }, { secret: "w".repeat(64) })).status).toBe(401);
    expect((await signedFetch(t, "/automation/events/claim", { eventId }, { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    const unsigned = await t.fetch("/automation/events/claim", { method: "POST", body: JSON.stringify({ eventId }) });
    expect(unsigned.status).toBe(401);
    expect((await signedFetch(t, "/automation/events/claim", { eventId: "bad id!" })).status).toBe(400);
    expect((await signedFetch(t, "/automation/events/claim", { eventId, extra: 1 })).status).toBe(400);

    const nonce = crypto.randomUUID();
    const ok = await signedFetch(t, "/automation/events/claim", { eventId }, { nonce });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "claimed" });
    const replay = await signedFetch(t, "/automation/events/claim", { eventId }, { nonce });
    expect(replay.status).toBe(409);
  });

  it("deduplicates event delivery by event id", async () => {
    const t = setup();
    const { events } = await newRequestEvent(t);
    const eventId = events[0]!.eventId;
    expect(await (await signedFetch(t, "/automation/events/claim", { eventId })).json()).toEqual({ status: "claimed" });
    // A concurrent execution sees the lease.
    expect(await (await signedFetch(t, "/automation/events/claim", { eventId })).json()).toEqual({ status: "in_progress" });
    // Failure releases the lease for a retry …
    await signedFetch(t, "/automation/events/report", { eventId, result: "FAILED", error: "SMTP 451 for owner@example.com" });
    expect(await (await signedFetch(t, "/automation/events/claim", { eventId })).json()).toEqual({ status: "claimed" });
    // … success makes later deliveries duplicates.
    await signedFetch(t, "/automation/events/report", { eventId, result: "MOCKED" });
    expect(await (await signedFetch(t, "/automation/events/claim", { eventId })).json()).toEqual({ status: "duplicate" });
    const [ev] = await t.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(ev!.deliveryResult).toBe("MOCKED");
    expect(await (await signedFetch(t, "/automation/events/claim", { eventId: "evt_unknown" })).json()).toEqual({ status: "unknown" });
  });

  it("records sanitised workflow errors and run summaries", async () => {
    const t = setup();
    const res = await signedFetch(t, "/automation/errors", {
      workflowName: "LendLoop · Request notification",
      executionId: "42",
      failedNode: "Send email",
      errorMessage: "SMTP auth failed for priya@example.com password=hunter2 token: abc123",
      relatedEventId: "evt_abc",
    });
    expect(res.status).toBe(200);
    const [failure] = await t.run((ctx) => ctx.db.query("automationFailures").collect());
    expect(failure!.errorMessage).not.toContain("priya@example.com");
    expect(failure!.errorMessage).not.toContain("hunter2");
    expect(failure!.errorMessage).not.toContain("abc123");
    expect(failure).toMatchObject({ failedNode: "Send email", executionId: "42", status: "OPEN" });

    const run = await signedFetch(t, "/automation/runs", { workflowName: "overdue", processed: 3, sent: 2, skipped: 1, failed: 0 });
    expect(run.status).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("automationRuns").collect())).toHaveLength(1);
  });

  it("reports 503 when the inbound secret is missing", async () => {
    const t = setup({ AUTOMATION_INBOUND_SECRET: "" });
    expect((await signedFetch(t, "/automation/runs", { workflowName: "x", processed: 0, sent: 0, skipped: 0, failed: 0 })).status).toBe(503);
  });
});

describe("overdue reminders (Workflow B)", () => {
  it("lists overdue loans and allows exactly one reminder per loan per day", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await activeLoan(t, owner, borrower);
    await t.run((ctx) => ctx.db.patch(loanId, { returnBy: Date.now() - 2 * 24 * 3600 * 1000 }));
    await t.mutation(internal.scheduled.markOverdueLoans, {});

    const period = reminderPeriod(Date.now());
    const list = await (await signedFetch(t, "/automation/overdue/candidates", {})).json();
    expect(list.period).toBe(period);
    expect(list.items).toEqual([expect.objectContaining({ loanId, daysOverdue: 2 })]); // floor, not ceil

    const claim = await (await signedFetch(t, "/automation/reminders/claim", { loanId, period, executionId: "1" })).json();
    expect(claim).toMatchObject({ status: "claimed", recipient: { email: "borrower@example.com" } });
    expect(claim.message.subject).toContain("2 days overdue");

    expect(await (await signedFetch(t, "/automation/reminders/claim", { loanId, period })).json()).toEqual({ status: "in_progress" });
    await signedFetch(t, "/automation/reminders/report", { loanId, period, result: "SENT" });
    expect(await (await signedFetch(t, "/automation/reminders/claim", { loanId, period })).json()).toEqual({ status: "duplicate" });
    expect((await (await signedFetch(t, "/automation/overdue/candidates", {})).json()).items).toEqual([]);

    // A new day is a new reminder period.
    const tomorrow = reminderPeriod(Date.now() + 24 * 3600 * 1000);
    expect((await (await signedFetch(t, "/automation/reminders/claim", { loanId, period: tomorrow })).json()).status).toBe("claimed");
  });

  it("refuses reminders for loans that are not overdue", async () => {
    const t = setup();
    const owner = await createUser(t, "owner");
    const borrower = await createUser(t, "borrower");
    const { loanId } = await activeLoan(t, owner, borrower);
    const res = await (await signedFetch(t, "/automation/reminders/claim", { loanId, period: reminderPeriod(Date.now()) })).json();
    expect(res).toEqual({ status: "not_overdue" });
  });
});
