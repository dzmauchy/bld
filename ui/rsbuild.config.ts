import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  output: {
    copy: [{ from: "../core/assets/schemas", to: "schemas" }],
  },
  tools: {
    rspack: {
      node: {
        __dirname: "mock",
        __filename: "mock",
      },
    },
  },
});
