import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { target: "es2025" },
  test: {
    include: ["tests/{unit,integration}/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
