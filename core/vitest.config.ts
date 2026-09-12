import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/{unit,integration}/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
