import { defineConfig } from "@rstest/core";
import { withRsbuildConfig } from "@rstest/adapter-rsbuild";

export default defineConfig({
  extends: withRsbuildConfig(),
  testEnvironment: "node",
  output: {
    module: true,
    overrideBrowserslist: ["chrome >= 135", "edge >= 135", "firefox >= 135", "safari >= 18.4"],
    bundleDependencies: ["core", "core/*"],
  },
  include: ["tests/{unit,integration}/**/*.test.ts"],
  testTimeout: 30_000,
});
