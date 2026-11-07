import path from "node:path";
import { expect, test } from "@playwright/test";
import { ensureOnboarded, readShownCode, signedInPage } from "./helpers";
import { E2E_USERS } from "./users";

const PHOTO = path.join(__dirname, "fixtures", "tool.png");

test("two neighbours complete a full borrow → lend → return lifecycle", async ({ browser }) => {
  // Two browsers through the whole flow; first visits compile pages on a dev server.
  test.setTimeout(300_000);
  const toolName = `E2E Drill ${Date.now().toString(36)}`;

  // 1–2. Owner signs in (first visit → onboarding) and lists a tool.
  const owner = await signedInPage(browser, E2E_USERS.owner.email);
  await ensureOnboarded(owner, "Indiranagar");
  await owner.goto("/listings/new");
  await owner.getByLabel("Name", { exact: true }).fill(toolName);
  await owner.getByLabel("Description").fill("Cordless drill with two batteries. Created by the E2E test.");
  await owner.locator('input[type="file"]').setInputFiles(PHOTO);
  await expect(owner.getByText("Cover")).toBeVisible();
  await owner.getByLabel("Neighbourhood (public)").fill("Indiranagar, Bengaluru");
  await expect(owner.locator('[class*="picker"] [data-map-status="ready"]')).toBeVisible();
  await owner.locator('[class*="picker"] [data-map-status="ready"] canvas').first().click({ position: { x: 300, y: 150 } });
  await expect(owner.getByText("Drag the pin to adjust.")).toBeVisible();
  await owner.getByRole("button", { name: "Publish listing" }).click();
  await owner.waitForURL(/\/listings$/);
  await expect(owner.getByRole("heading", { name: toolName })).toBeVisible();

  // 3–5. Borrower signs in, uses their location, finds the tool on the map and requests it.
  const borrower = await signedInPage(browser, E2E_USERS.borrower.email);
  await ensureOnboarded(borrower, "Domlur");
  const prompt = borrower.getByRole("button", { name: "Use my location" });
  if (await prompt.isVisible().catch(() => false)) await prompt.click();
  await borrower.getByRole("searchbox", { name: "Search tools or categories" }).fill(toolName);
  const item = borrower.getByRole("list", { name: "Tools" }).getByRole("button", { name: new RegExp(toolName) }).first();
  await expect(item).toBeVisible();
  await item.click();
  await expect(borrower.locator('.ll-marker-host button[aria-pressed="true"]')).toBeVisible();
  await borrower.getByRole("button", { name: "Request to borrow" }).click();
  // Typed key by key: a dialog re-focus bug once dropped everything after the first letter.
  const note = "Putting up shelves this weekend.";
  await borrower.getByLabel("Message to owner").pressSequentially(note, { delay: 15 });
  await expect(borrower.getByLabel("Message to owner")).toHaveValue(note);
  await borrower.getByRole("button", { name: "Send request" }).click();
  await expect(borrower.getByRole("dialog", { name: "Request sent" })).toBeVisible();
  await borrower.goto("/requests?tab=PENDING");
  await expect(borrower.getByRole("heading", { name: toolName })).toBeVisible();

  // 6–7. Owner is notified in real time and approves after reviewing reputation.
  await owner.goto("/incoming");
  await expect(owner.getByRole("button", { name: /Notifications \(\d+ unread\)/ })).toBeVisible();
  const card = owner.locator("li", { hasText: toolName });
  await expect(card.getByText("Verified history")).toBeVisible();
  await card.getByRole("button", { name: "Approve" }).click();
  await owner.getByRole("button", { name: "Approve request" }).click();
  // The request leaves "Awaiting you" live and appears under "Approved".
  await expect(card).toHaveCount(0);
  await owner.getByRole("tab", { name: "Approved" }).click();
  const approved = owner.locator("li", { hasText: toolName });
  await approved.getByRole("link", { name: /Open loan/ }).click();
  await owner.waitForURL(/\/loans\//);
  const loanUrl = owner.url();

  // 8–9. Borrower sees approval + exact pickup point and reveals the pickup code; owner verifies it.
  await borrower.goto(loanUrl);
  await expect(borrower.getByRole("heading", { name: /Pickup location/ })).toBeVisible();
  // Bonus: automation activity for this loan (request created → owner, approved → borrower).
  await expect(borrower.getByRole("heading", { name: "Automation" })).toBeVisible();
  await expect(borrower.getByText(/notified · request approved/)).toBeVisible();
  await borrower.getByRole("button", { name: "Show pickup code" }).click();
  const pickupCode = await readShownCode(borrower);
  expect(pickupCode).toMatch(/^\d{6}$/);
  // A wrong code is rejected with remaining attempts.
  await owner.getByLabel("6-digit code").fill(pickupCode === "000000" ? "111111" : "000000");
  await owner.getByRole("button", { name: "Verify pickup" }).click();
  await expect(owner.getByText(/That code is incorrect\. 4 attempts left/)).toBeVisible();
  await owner.getByLabel("6-digit code").fill(pickupCode);
  await owner.getByRole("button", { name: "Verify pickup" }).click();

  // 10. Loan becomes active for both, live.
  await expect(owner.getByText("Active", { exact: true }).first()).toBeVisible();
  await expect(borrower.getByRole("button", { name: "Return item" })).toBeVisible();

  // 11–12. Borrower requests the return with a photo; owner is notified and confirms.
  await borrower.getByRole("button", { name: "Return item" }).click();
  await borrower.getByRole("dialog").locator('input[type="file"]').setInputFiles(PHOTO);
  await expect(borrower.getByRole("dialog").getByText("Cover")).toBeVisible();
  await borrower.getByRole("button", { name: "Confirm return request" }).click();
  await expect(owner.getByText(/is ready to return your item/)).toBeVisible();
  await owner.getByRole("button", { name: "Confirm returned" }).click();

  // 13. Return code verified by the owner.
  await borrower.getByRole("button", { name: "Show return code" }).click();
  const returnCode = await readShownCode(borrower);
  await owner.getByLabel("6-digit code").fill(returnCode);
  await owner.getByRole("button", { name: "Verify return" }).click();

  // 14. Completed for both.
  await expect(owner.getByText("Completed", { exact: true }).first()).toBeVisible();
  await expect(borrower.getByText("Completed", { exact: true }).first()).toBeVisible();

  // 15. Both parties leave feedback.
  await borrower.getByRole("radio", { name: "5 stars" }).click();
  await borrower.getByRole("button", { name: "Submit feedback" }).click();
  await expect(borrower.getByText("You wrote")).toBeVisible();
  await owner.getByRole("radio", { name: "4 stars" }).click();
  await owner.getByRole("button", { name: "Returned on time" }).click();
  await owner.getByRole("button", { name: "Submit feedback" }).click();
  await expect(owner.getByText("You wrote")).toBeVisible();
  await expect(owner.getByText(/wrote about you/)).toBeVisible();

  // Unauthorised access: the borrower can't use admin pages; strangers can't open the loan.
  await borrower.goto("/admin");
  await expect(borrower.getByText("Administrators only")).toBeVisible();
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(loanUrl);
  await expect(strangerPage).toHaveURL(/\/sign-in/);

  // Clean up: the owner deletes the listing (history is preserved).
  await owner.goto("/listings");
  await owner.getByRole("button", { name: `Delete ${toolName}` }).click();
  await owner.getByRole("button", { name: "Delete listing" }).click();
  await expect(owner.getByRole("heading", { name: toolName })).toHaveCount(0);
});
