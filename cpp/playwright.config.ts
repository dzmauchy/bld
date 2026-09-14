import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 300_000,
  expect: {
    timeout: 60_000,
  },
  use: {
    baseURL: "http://localhost:3002",
    trace: "on-first-retry",
    launchOptions: {
      args: [
        "--enable-experimental-webassembly-features",
        "--js-flags=--wasm-custom-descriptors,--wasm-compact-imports,--experimental-wasm-compact-imports,--wasm-staging",
      ],
    },
  },
  webServer: {
    command: "rsbuild build && rsbuild preview --port 3002",
    url: "http://localhost:3002",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
