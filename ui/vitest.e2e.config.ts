import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "ui-e2e", include: ["e2e/**/*.spec.ts"],
    exclude: process.env.MANUAL ? [] : ["**/*.manual.spec.ts"],
    globalSetup: ["../tests/e2e/server.ts"],
    reporters: ["verbose"], fileParallelism: false, testTimeout: 180_000, hookTimeout: 180_000,
    expect: { poll: { timeout: 10_000, interval: 50 } },
  },
});
