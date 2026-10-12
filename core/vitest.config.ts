import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "core", environment: "node",
    include: process.env.MANUAL ? ["tests/**/*.manual.test.ts"] : ["tests/{unit,integration}/**/!(*.manual).test.ts"],
    setupFiles: ["tests/setup.ts"], hookTimeout: 60_000, testTimeout: 60_000,
  },
});
