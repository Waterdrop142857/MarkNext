import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  // Playwright clears outputDir before each run. Keep browser traces separate
  // from the Vitest and document-action reports produced earlier by pnpm check.
  outputDir: "test-results/browser",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  workers: 2,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }], ["junit", { outputFile: "test-results/browser.xml" }]],
  use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        ...(process.env.MARKNEXT_WEBKIT_EXECUTABLE ? { launchOptions: { executablePath: process.env.MARKNEXT_WEBKIT_EXECUTABLE } } : {}),
      },
    },
  ],
  webServer: [
    {
      command: "pnpm exec vite --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173/tests/e2e/app.html",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "pnpm exec vite preview --host 127.0.0.1 --port 4174 --strictPort",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
