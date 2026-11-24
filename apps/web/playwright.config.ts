import { defineConfig, devices } from "@playwright/test";

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();

export default defineConfig({
  testDir: "./tests/e2e",
  // Next dev can corrupt its route cache when several device projects request
  // the same freshly compiled route at once. Keep local/CI browser validation
  // deterministic; service flows themselves may still use parallel API calls.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: externalBaseURL || "http://127.0.0.1:3011",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "android-360",
      use: { ...devices["Galaxy S9+"], viewport: { width: 360, height: 800 } },
    },
    {
      name: "android-390",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
    },
    {
      name: "android-412",
      use: { ...devices["Pixel 7"], viewport: { width: 412, height: 915 } },
    },
    {
      name: "tablet-768",
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop-1280",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: "npm run dev -- --hostname 127.0.0.1 --port 3011",
        url: "http://127.0.0.1:3011/login",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: { ...process.env, BHT_DB_BRANCH: "dev" },
      },
});
