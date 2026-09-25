import { defineConfig } from "@rstest/core";
import { withRsbuildConfig } from "@rstest/adapter-rsbuild";

export default defineConfig({
  extends: withRsbuildConfig(),
  testEnvironment: "node",
  source: {
    assetsInclude: /_headers$/,
  },
  output: {
    module: true,
    overrideBrowserslist: ["chrome >= 135", "edge >= 135", "firefox >= 135", "safari >= 18.4"],
    bundleDependencies: ["core", "core/*", "cpp", "cpp/*"],
  },
  include: ["tests/{unit,integration}/**/*.test.ts", "e2e/**/*.test.ts"],
});
