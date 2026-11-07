import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. Requires:
 *  - Clerk dev keys in .env.local (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY)
 *  - the Convex dev deployment running (`npx convex dev`) and trusting that Clerk issuer
 *  - E2E users (see tests/e2e/README.md); created automatically by global setup if missing.
 */
const PORT = Number(process.env.E2E_PORT ?? 3000);
/** Set E2E_BASE_URL (e.g. https://lendloopapp.vercel.app) to run the suite against a deployed site. */
const REMOTE = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./tests/e2e/global.setup.ts",
  use: {
    baseURL: REMOTE ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    launchOptions: {
      // MapLibre needs WebGL; use SwiftShader so it renders in headless/CI browsers.
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
      // Use the locally installed Chrome when Playwright's bundled browsers aren't installed.
      ...(process.env.PLAYWRIGHT_CHROME_PATH
        ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
        : {}),
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: REMOTE
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
