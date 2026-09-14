import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  source: {
    entry: {
      index: "./src/browser/index.ts",
    },
  },
  html: {
    template: "./src/browser/index.html",
  },
  output: {
    distPath: {
      root: "dist/web",
    },
    copy: [{ from: "vendor", to: "toolchain" }],
  },
  server: {
    port: 3002,
  },
});
