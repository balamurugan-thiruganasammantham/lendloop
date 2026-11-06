import { expect, test } from "@playwright/test";

test.describe("public landing page", () => {
  test("shows the brand, approximate tool locations and a sign-in CTA without private data", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Borrow what you need.");
    await expect(page.getByRole("link", { name: /Sign in to borrow|Open the map/ })).toBeVisible();
    await expect(page.locator('[data-map-status="ready"] canvas').first()).toBeVisible();
    // Exact addresses and private fields never reach anonymous visitors.
    const html = await page.content();
    expect(html).not.toContain("Sample address near");
    expect(html).not.toMatch(/@seed\.lendloop\.invalid/);
  });

  test("redirects signed-out visitors away from the app", async ({ page }) => {
    await page.goto("/loans");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
