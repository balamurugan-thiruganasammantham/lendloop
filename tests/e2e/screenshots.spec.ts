import { expect, test } from "@playwright/test";
import { ensureOnboarded, signedInPage } from "./helpers";
import { E2E_USERS } from "./users";

/**
 * Opt-in visual capture of key screens for review/README:
 *   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts
 */
test.skip(!process.env.CAPTURE_SCREENSHOTS, "Set CAPTURE_SCREENSHOTS=1 to capture screenshots");

const OUT = "docs/screenshots";

test("capture desktop and mobile screens", async ({ browser }) => {
  const page = await signedInPage(browser, E2E_USERS.borrower.email);
  await ensureOnboarded(page, "Domlur");
  const useLoc = page.getByRole("button", { name: "Use my location" });
  if (await useLoc.isVisible().catch(() => false)) await useLoc.click();
  await expect(page.locator(".ll-marker-host").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/explore-desktop.png` });

  await page.getByRole("list", { name: "Tools" }).getByRole("button", { name: /Cordless Drill/ }).first().click();
  await expect(page.getByRole("button", { name: "Request to borrow" })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/explore-detail.png` });
  await page.getByRole("button", { name: "Request to borrow" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/request-modal.png` });
  await page.keyboard.press("Escape");

  for (const [path, name] of [
    ["/requests?tab=COMPLETED", "requests"],
    ["/history", "history"],
    ["/profile", "profile"],
    ["/listings", "listings"],
  ] as const) {
    await page.goto(path);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }
  await page.goto("/history");
  const loanLink = page.locator('a[href^="/loans/"]').first();
  await loanLink.waitFor({ timeout: 15_000 }).catch(() => undefined);
  if (await loanLink.count()) {
    await loanLink.click();
    await page.waitForURL(/\/loans\//);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/loan-detail.png`, fullPage: true });
  }

  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: { latitude: 12.9719, longitude: 77.6412 },
    permissions: ["geolocation"],
    storageState: await page.context().storageState(),
  });
  const mobile = await mobileCtx.newPage();
  await mobile.goto("/explore");
  await expect(mobile.locator(".ll-marker-host").first()).toBeVisible();
  await mobile.waitForTimeout(1500);
  await mobile.screenshot({ path: `${OUT}/explore-mobile.png` });
});
