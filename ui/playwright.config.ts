import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  expect: {
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    launchOptions: {
      args: [
        "--enable-experimental-webassembly-features",
        "--js-flags=--wasm-custom-descriptors,--wasm-compact-imports,--experimental-wasm-compact-imports,--wasm-staging",
      ],
    },
  },
  timeout: 180_000,
  webServer: {
    command: "node scripts/fetch-base-release.mjs && rsbuild build && rsbuild preview --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
