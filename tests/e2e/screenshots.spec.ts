import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { ensureOnboarded, signedInPage } from "./helpers";
import { E2E_LOCATION, E2E_USERS } from "./users";

/**
 * Opt-in capture of the README / project-document screenshots (run against a seeded dev deployment):
 *   CAPTURE_SCREENSHOTS=1 npx playwright test tests/e2e/screenshots.spec.ts
 * Optional: N8N_SHOT_URL + N8N_SHOT_EMAIL + N8N_SHOT_PASSWORD to also capture the n8n workflow editor.
 */
test.skip(!process.env.CAPTURE_SCREENSHOTS, "Set CAPTURE_SCREENSHOTS=1 to capture screenshots");

const OUT = "docs/screenshots";
const PHOTO = path.join(__dirname, "..", "..", "seed-assets", "tools", "saw.jpg");

/** Hide the Next.js dev badge (no-op against a production build). */
async function hideDevBadge(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => undefined);
}

async function settle(page: Page, ms = 1800) {
  await hideDevBadge(page);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(ms);
}

test("capture screens", async ({ browser }) => {
  test.setTimeout(420_000);

  // 1. Public landing page (signed out), with the visitor's location.
  const visitorCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: E2E_LOCATION, permissions: ["geolocation"] });
  const visitor = await visitorCtx.newPage();
  await visitor.goto("/");
  await expect(visitor.locator('[data-map-status="ready"]').first()).toBeVisible({ timeout: 60_000 });
  await settle(visitor, 9000);
  await visitor.screenshot({ path: `${OUT}/01-landing.png` });
  await visitorCtx.close();

  // 2–5. Borrower: map with category index, list view, tool detail, request dialog.
  const borrower = await signedInPage(browser, E2E_USERS.borrower.email);
  await ensureOnboarded(borrower, "Domlur");
  await borrower.goto("/explore");
  await expect(borrower.getByText("Live location on")).toBeVisible({ timeout: 30_000 });
  await settle(borrower, 3500);
  await borrower.screenshot({ path: `${OUT}/02-explore-map.png` });

  await borrower.goto("/explore?view=list");
  await settle(borrower, 2500);
  await borrower.screenshot({ path: `${OUT}/03-explore-list.png` });

  await borrower.goto("/explore");
  await settle(borrower, 2000);
  await borrower.getByRole("list", { name: "Tools" }).getByRole("button", { name: /Cordless Drill/ }).first().click();
  await expect(borrower.getByRole("button", { name: "Request to borrow" })).toBeVisible();
  await settle(borrower, 2500);
  await borrower.screenshot({ path: `${OUT}/04-tool-detail.png` });

  // 6. Owner lists a tool with a real photo.
  const owner = await signedInPage(browser, E2E_USERS.owner.email);
  await ensureOnboarded(owner, "Indiranagar");
  const toolName = "Circular Saw (7¼″)";
  await owner.goto("/listings/new");
  await owner.getByLabel("Name", { exact: true }).fill(toolName);
  await owner.getByLabel("Description").fill("1400 W circular saw with a fresh 24-tooth blade and a rip fence. Safety glasses included.");
  await owner.locator('input[type="file"]').setInputFiles(PHOTO);
  await expect(owner.getByText("Cover")).toBeVisible();
  await owner.getByLabel("Neighbourhood (public)").fill("Indiranagar, Bengaluru");
  await expect(owner.locator('[class*="picker"] [data-map-status="ready"]')).toBeVisible();
  await owner.locator('[class*="picker"] [data-map-status="ready"] canvas').first().click({ position: { x: 300, y: 150 } });
  await owner.getByRole("button", { name: "Publish listing" }).click();
  await owner.waitForURL(/\/listings$/);

  // Borrower requests it (typed message) → request dialog screenshot.
  await borrower.goto("/explore");
  await borrower.getByRole("searchbox", { name: "Search tools or categories" }).fill("Circular Saw");
  await borrower.getByRole("list", { name: "Tools" }).getByRole("button", { name: /Circular Saw/ }).first().click();
  await borrower.getByRole("button", { name: "Request to borrow" }).click();
  await borrower.getByLabel("Message to owner").pressSequentially("Hi! Building a bookshelf this weekend. Happy to pick up after 6 pm.", { delay: 5 });
  await settle(borrower, 800);
  await borrower.screenshot({ path: `${OUT}/05-request-modal.png` });
  await borrower.getByRole("button", { name: "Send request" }).click();
  await expect(borrower.getByRole("dialog", { name: "Request sent" })).toBeVisible();

  // 7. Owner's incoming request (with the borrower's verified history), then approve.
  await owner.goto("/incoming");
  const card = owner.locator("li", { hasText: toolName });
  await expect(card.getByRole("button", { name: "Approve" })).toBeVisible();
  await settle(owner, 1500);
  await owner.screenshot({ path: `${OUT}/06-incoming-request.png` });
  await card.getByRole("button", { name: "Approve" }).click();
  await owner.getByRole("button", { name: "Approve request" }).click();
  await owner.getByRole("tab", { name: "Approved" }).click();
  await owner.locator("li", { hasText: toolName }).getByRole("link", { name: /Open loan/ }).click();
  await owner.waitForURL(/\/loans\//);
  const loanUrl = owner.url();

  // 8. Borrower's loan page: exact pickup point, route, hand-over code, automation activity.
  await borrower.goto(loanUrl);
  await borrower.getByRole("button", { name: "Show pickup code" }).click();
  await expect(borrower.getByRole("heading", { name: "Automation" })).toBeVisible();
  await settle(borrower, 4000);
  await borrower.screenshot({ path: `${OUT}/07-loan-borrower.png`, fullPage: true });

  // 9. Owner's loan page: verify the code.
  await owner.goto(loanUrl);
  await settle(owner, 3000);
  await owner.screenshot({ path: `${OUT}/08-loan-owner.png`, fullPage: true });

  // 10. Mobile explore.
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: E2E_LOCATION,
    permissions: ["geolocation"],
    storageState: await borrower.context().storageState(),
  });
  const mobile = await mobileCtx.newPage();
  await mobile.goto("/explore");
  await expect(mobile.locator(".ll-marker-host").first()).toBeVisible({ timeout: 30_000 });
  await settle(mobile, 2500);
  await mobile.screenshot({ path: `${OUT}/10-mobile-explore.png` });
  await mobileCtx.close();

  // 11. Admin automation (only if the owner account has been made admin in this deployment).
  if (process.env.CAPTURE_ADMIN) {
    await owner.goto("/admin?tab=automation");
    await settle(owner, 3000);
    await owner.screenshot({ path: `${OUT}/09-admin-automation.png`, fullPage: true });
  }

  // Clean up: cancel the demo loan and delete the demo listing (safe to run against production).
  await owner.goto(loanUrl);
  await owner.getByRole("button", { name: "Cancel this loan" }).click();
  await owner.getByRole("button", { name: "Cancel loan" }).click();
  await expect(owner.getByText(/This loan was cancelled/)).toBeVisible();
  await owner.goto("/listings");
  await owner.getByRole("button", { name: `Delete ${toolName}` }).click();
  await owner.getByRole("button", { name: "Delete listing" }).click();
  await expect(owner.getByRole("heading", { name: toolName })).toHaveCount(0);

  // 12. n8n workflow editor.
  const { N8N_SHOT_URL, N8N_SHOT_EMAIL, N8N_SHOT_PASSWORD } = process.env;
  if (N8N_SHOT_URL && N8N_SHOT_EMAIL && N8N_SHOT_PASSWORD) {
    const n8nCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const n8n = await n8nCtx.newPage();
    await n8n.goto(`${N8N_SHOT_URL}/signin`, { timeout: 120_000 });
    await n8n.getByLabel(/Email/i).fill(N8N_SHOT_EMAIL);
    await n8n.getByLabel(/Password/i).fill(N8N_SHOT_PASSWORD);
    await n8n.getByRole("button", { name: /Sign in/i }).click();
    await n8n.waitForURL(/home|workflows/, { timeout: 60_000 });
    for (const [id, file] of [
      ["lendloopReqNotif", "11-n8n-request-notification"],
      ["lendloopOverdueR", "12-n8n-overdue-reminders"],
    ] as const) {
      await n8n.goto(`${N8N_SHOT_URL}/workflow/${id}`);
      await settle(n8n, 5000);
      await n8n.keyboard.press("Shift+1").catch(() => undefined); // zoom to fit
      await settle(n8n, 1200);
      await n8n.screenshot({ path: `${OUT}/${file}.png` });
    }
    await n8nCtx.close();
  }
});
