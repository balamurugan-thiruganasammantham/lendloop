#!/usr/bin/env node
// Sends a signed sample LendLoop event to the n8n webhook (Workflow A), exactly
// like Convex does, so the workflow can be tested without running the app.
//
//   node n8n/scripts/send-test-event.mjs                    # valid event -> 200
//   node n8n/scripts/send-test-event.mjs --event-id evt_abc # a specific (e.g. real) event id
//   node n8n/scripts/send-test-event.mjs --bad-signature    # -> 401
//   node n8n/scripts/send-test-event.mjs --stale            # -> 401
//   node n8n/scripts/send-test-event.mjs --malformed        # -> 400
//
// The secret is read from LENDLOOP_N8N_WEBHOOK_SECRET, or from n8n/.env.
// No dependencies; Node 18+.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HELP = `Usage: node n8n/scripts/send-test-event.mjs [options]

  --url <url>          Webhook URL (default: $LENDLOOP_TEST_WEBHOOK_URL or
                       http://localhost:5678/webhook/lendloop-events)
  --test               Use the editor test URL (/webhook-test/...) instead
  --event-id <id>      eventId to send (default: random evt_test...)
  --event-type <type>  eventType (default: borrow_request.created)
  --email <address>    Recipient email (default: test.recipient@example.com)
  --env-file <path>    File holding LENDLOOP_N8N_WEBHOOK_SECRET (default: n8n/.env)
  --stale              Timestamp 10 minutes in the past        (expect 401)
  --bad-signature      Sign with a random wrong secret          (expect 401)
  --malformed          Correctly signed but schema-invalid body (expect 400)
  --repeat <n>         Send the same event n times (dedup check; new nonce each time)
  --expect <status>    Exit 1 unless every response has this HTTP status
  --print-payload      Print the JSON payload that is sent
  -h, --help           Show this help
`;

const { values: opts } = parseArgs({
  options: {
    url: { type: 'string' },
    test: { type: 'boolean', default: false },
    'event-id': { type: 'string' },
    'event-type': { type: 'string', default: 'borrow_request.created' },
    email: { type: 'string', default: 'test.recipient@example.com' },
    'env-file': { type: 'string' },
    stale: { type: 'boolean', default: false },
    'bad-signature': { type: 'boolean', default: false },
    malformed: { type: 'boolean', default: false },
    repeat: { type: 'string', default: '1' },
    expect: { type: 'string' },
    'print-payload': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (opts.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(opts['env-file'] ?? resolve(scriptDir, '..', '.env'));
const secret = process.env.LENDLOOP_N8N_WEBHOOK_SECRET || readEnvFile(envFile).LENDLOOP_N8N_WEBHOOK_SECRET;
if (!secret || secret.length < 32 || secret.startsWith('replace-with')) {
  console.error(`LENDLOOP_N8N_WEBHOOK_SECRET is not set (env or ${envFile}).`);
  process.exit(2);
}

const defaultUrl = process.env.LENDLOOP_TEST_WEBHOOK_URL || 'http://localhost:5678/webhook/lendloop-events';
const url = opts.url ?? (opts.test ? defaultUrl.replace('/webhook/', '/webhook-test/') : defaultUrl);
const eventId = opts['event-id'] ?? `evt_test${randomBytes(8).toString('hex')}`;

// Same shape and key order Convex uses (convex/automation.ts, AutomationWebhookPayload).
let payload = {
  schemaVersion: 1,
  eventId,
  eventType: opts['event-type'],
  occurredAt: new Date().toISOString(),
  recipient: { userId: 'testuser000000000000000000000001', email: opts.email, displayName: 'Arun K.' },
  subject: { requestId: 'testrequest00000000000000000001', loanId: null, toolId: 'testtool0000000000000000000001', toolName: 'Cordless Drill', status: 'PENDING' },
  message: { title: 'New borrow request', body: 'Priya wants to borrow your Cordless Drill (7 Nov – 9 Nov).' },
  link: 'http://localhost:3000/incoming',
};
if (opts.malformed) {
  // Wrong schema version, bad email, missing message.body, unknown field.
  payload = { ...payload, schemaVersion: 2, recipient: { ...payload.recipient, email: 'not-an-email' }, message: { title: 'x' }, extra: true };
}

async function sendOnce(n) {
  const body = JSON.stringify(payload); // compact, exactly what is signed
  const timestamp = Math.floor(Date.now() / 1000) - (opts.stale ? 600 : 0);
  const nonce = randomUUID();
  const key = opts['bad-signature'] ? randomBytes(32).toString('hex') : secret;
  const signature = `sha256=${createHmac('sha256', key).update(`${timestamp}.${nonce}.${body}`).digest('hex')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-lendloop-timestamp': String(timestamp),
      'x-lendloop-nonce': nonce,
      'x-lendloop-signature': signature,
      'x-lendloop-event-id': payload.eventId,
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  console.log(`[${n}] POST ${url} eventId=${payload.eventId} -> HTTP ${res.status} ${text}`);
  return res.status;
}

if (opts['print-payload']) console.log(JSON.stringify(payload, null, 2));
const repeat = Math.max(1, Number.parseInt(opts.repeat, 10) || 1);
let ok = true;
try {
  for (let i = 1; i <= repeat; i++) {
    const status = await sendOnce(i);
    if (opts.expect && String(status) !== opts.expect) ok = false;
  }
} catch (error) {
  console.error(`Request failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
if (!ok) {
  console.error(`Expected HTTP ${opts.expect}`);
  process.exit(1);
}
