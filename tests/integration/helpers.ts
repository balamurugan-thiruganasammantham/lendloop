import { convexTest } from "convex-test";
import { vi } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { modules } from "../../convex/test.setup";
import { TIME } from "../../convex/lib/constants";

export const OTP_PEPPER = "p".repeat(64);
export const INBOUND_SECRET = "i".repeat(64);
export const N8N_SECRET = "n".repeat(64);

export function setup(env: Record<string, string> = {}) {
  vi.stubEnv("OTP_PEPPER", OTP_PEPPER);
  vi.stubEnv("AUTOMATION_INBOUND_SECRET", INBOUND_SECRET);
  vi.stubEnv("EMAIL_DELIVERY_MODE", "mock");
  vi.stubEnv("APP_URL", "https://lendloop.test");
  vi.stubEnv("SEED_ENABLED", "true");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return convexTest(schema, modules);
}

export type T = ReturnType<typeof setup>;

export async function createUser(t: T, key: string, name = `${key[0]!.toUpperCase()}${key.slice(1)} Tester`) {
  const identity = {
    subject: `user_${key}`,
    issuer: "https://clerk.test",
    tokenIdentifier: `https://clerk.test|user_${key}`,
    name,
    email: `${key}@example.com`,
  };
  const as = t.withIdentity(identity);
  const { userId } = await as.mutation(api.users.ensureCurrent, {});
  return { as, userId, identity };
}

export type TestUser = Awaited<ReturnType<typeof createUser>>;

export async function uploadImage(t: T, user: TestUser): Promise<Id<"_storage">> {
  const storageId = await t.run((ctx) =>
    ctx.storage.store(new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" })),
  );
  await user.as.mutation(api.files.registerUpload, { storageId });
  return storageId;
}

export const EXACT = { lat: 12.97161, lng: 77.64125 };

export async function createTool(t: T, owner: TestUser, overrides: Partial<{ name: string; maxLoanDays: number }> = {}) {
  const image = await uploadImage(t, owner);
  return owner.as.mutation(api.tools.create, {
    name: overrides.name ?? "Cordless Drill",
    category: "POWER_TOOLS",
    description: "18V drill with two batteries and a bit set.",
    condition: "GOOD",
    imageIds: [image],
    pickupArea: "Indiranagar, Bengaluru",
    pickupLocation: EXACT,
    pickupAddress: "12 Secret Lane",
    instructions: "Charge before returning.",
    maxLoanDays: overrides.maxLoanDays ?? 5,
  });
}

export function window(startInDays = 1, lengthDays = 2) {
  const pickupAt = Date.now() + startInDays * TIME.day;
  return { pickupAt, returnBy: pickupAt + lengthDays * TIME.day };
}

/** Run scheduled functions (OTP issuance, outbox delivery) to completion. */
export async function drain(t: T) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

/** Read the latest hand-over code for a user from the development mailbox. */
export async function latestCodeFor(t: T, userId: Id<"users">): Promise<string> {
  const messages = await t.run((ctx) =>
    ctx.db
      .query("devMailbox")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect(),
  );
  const match = messages.map((m) => /code for .* is: (\d{6})/.exec(m.text)).find(Boolean);
  if (!match) throw new Error("No code in mailbox");
  return match[1]!;
}

/** Owner approves; the collection code is issued by a scheduled action. */
export async function approvedLoan(t: T, owner: TestUser, borrower: TestUser) {
  const toolId = await createTool(t, owner);
  const requestId = await borrower.as.mutation(api.requests.create, { toolId, ...window() });
  const loanId = await owner.as.mutation(api.requests.approve, { requestId });
  await drain(t);
  return { toolId, requestId, loanId };
}

export async function activeLoan(t: T, owner: TestUser, borrower: TestUser) {
  const ids = await approvedLoan(t, owner, borrower);
  const code = await latestCodeFor(t, borrower.userId);
  await owner.as.action(api.otpActions.verifyCode, { loanId: ids.loanId, purpose: "COLLECTION", code });
  return ids;
}

export async function errorData(promise: Promise<unknown>): Promise<{ code: string; message: string; [k: string]: unknown }> {
  try {
    await promise;
  } catch (e) {
    const data = (e as { data?: unknown }).data;
    if (data && typeof data === "object") return data as { code: string; message: string };
    throw e;
  }
  throw new Error("Expected the call to fail");
}
