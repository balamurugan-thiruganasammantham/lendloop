import { clerkSetup } from "@clerk/testing/playwright";
import { loadEnvConfig } from "@next/env";
import { E2E_USERS } from "./users";

/**
 * Obtains a Clerk testing token (bypasses bot protection for automated
 * browsers) and makes sure the two E2E users exist in the Clerk dev instance.
 */
export default async function globalSetup() {
  loadEnvConfig(process.cwd());
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    throw new Error("E2E tests need NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY (see README → Testing).");
  }
  await clerkSetup();
  for (const user of Object.values(E2E_USERS)) {
    const list = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(user.email)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    }).then((r) => r.json() as Promise<unknown[]>);
    if (Array.isArray(list) && list.length > 0) continue;
    const res = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email_address: [user.email],
        first_name: user.firstName,
        last_name: user.lastName,
        skip_password_requirement: true,
      }),
    });
    if (!res.ok) throw new Error(`Could not create E2E user ${user.email}: HTTP ${res.status}`);
  }
}
