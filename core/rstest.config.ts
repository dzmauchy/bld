import { defineConfig } from "@rstest/core";

export default defineConfig({
  output: {
    module: true,
    overrideBrowserslist: ["chrome >= 135", "edge >= 135", "firefox >= 135", "safari >= 18.4"],
    bundleDependencies: ["core", "core/*", "cpp", "cpp/*"],
  },
  include: ["tests/{unit,integration}/**/*.test.ts", "e2e/**/*.test.ts"],
  setupFiles: ["tests/setup.ts"],
  hookTimeout: 60_000,
  testTimeout: 60_000,
});
