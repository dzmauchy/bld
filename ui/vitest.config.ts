import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/{unit,integration}/**/*.test.ts", "e2e/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
