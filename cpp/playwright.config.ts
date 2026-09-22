import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";

const root = path.dirname(fileURLToPath(import.meta.url));

// Node gives FORCE_COLOR precedence and warns if NO_COLOR is also inherited.
if (process.env.FORCE_COLOR !== undefined) delete process.env.NO_COLOR;

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
    command: `npx rsbuild build --root "${root}" && npx rsbuild preview --root "${root}" --port 3002`,
    cwd: root,
    url: "http://localhost:3002",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
