import { defineConfig } from "@rstest/core";

export default defineConfig({
  output: {
    module: true,
    overrideBrowserslist: ["chrome >= 135", "edge >= 135", "firefox >= 135", "safari >= 18.4"],
  },
  projects: ["./core", "./ui", "./cpp"],
});
