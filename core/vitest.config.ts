import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// IDE runners pass the selected test file on the command line. Allow an explicit
// manual file selection without enabling manual profiles in routine test runs.
const manualFileSelected = process.argv.some((argument) => /\.manual\.test\.ts(?::\d+)?$/.test(argument));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    name: "core", environment: "node",
    include: process.env.MANUAL
      ? ["tests/**/*.manual.test.ts"]
      : [manualFileSelected ? "tests/{unit,integration}/**/*.test.ts" : "tests/{unit,integration}/**/!(*.manual).test.ts"],
    setupFiles: ["tests/setup.ts"], hookTimeout: 60_000, testTimeout: 60_000,
  },
});
