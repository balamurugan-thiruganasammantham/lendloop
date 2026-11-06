import { clerk } from "@clerk/testing/playwright";
import { expect, type Browser, type Page } from "@playwright/test";
import { E2E_LOCATION } from "./users";

export async function signedInPage(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext({
    geolocation: E2E_LOCATION,
    permissions: ["geolocation"],
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: email });
  return page;
}

/** Complete onboarding if this is the account's first visit. */
export async function ensureOnboarded(page: Page, area: string) {
  await page.goto("/explore");
  const onboarding = page.getByRole("heading", { name: "Set up your neighbour profile" });
  const nav = page.getByRole("navigation", { name: "Main" }).first();
  // The redirect to onboarding happens client-side after the profile syncs.
  await expect(onboarding.or(nav)).toBeVisible();
  if (await onboarding.isVisible()) {
    await page.getByLabel("Neighbourhood").fill(area);
    await page.getByRole("button", { name: "Start exploring" }).click();
    await page.waitForURL(/\/explore/);
  }
  await expect(nav).toBeVisible();
}

/** Read the six-digit hand-over code shown to the borrower. */
export async function readShownCode(page: Page): Promise<string> {
  const code = page.getByLabel(/^Code \d( \d){5}$/);
  await expect(code).toBeVisible();
  const label = (await code.getAttribute("aria-label")) ?? "";
  return label.replace(/\D/g, "");
}
