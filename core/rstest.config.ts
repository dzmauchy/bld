import { defineConfig } from "@rstest/core";

const isManual = Boolean(process.env.MANUAL);

export default defineConfig({
  output: {
    module: true,
    overrideBrowserslist: ["chrome >= 135", "edge >= 135", "firefox >= 135", "safari >= 18.4"],
    bundleDependencies: ["core", "core/*", "cpp", "cpp/*"],
  },
  include: isManual
    ? ["tests/{unit,integration}/**/*.manual.test.ts", "e2e/**/*.manual.test.ts"]
    : ["tests/{unit,integration}/**/!(*.manual).test.ts", "e2e/**/!(*.manual).test.ts"],
  setupFiles: ["tests/setup.ts"],
  hookTimeout: 60_000,
  testTimeout: 60_000,
});

