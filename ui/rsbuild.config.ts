import { defineConfig } from "@rsbuild/core";
import { attachLlvmToolchainProxy } from "./scripts/llvmToolchainProxyMiddleware.ts";

export default defineConfig({
  source: {
    entry: {
      index: "./src/index.ts",
    },
  },
  html: {
    template: "./index.html",
    scriptLoading: "module",
  },
  output: {
    module: true,
    overrideBrowserslist: ["chrome >= 135", "edge >= 135", "firefox >= 135", "safari >= 18.4"],
    copy: [
      { from: "../core/assets/schemas", to: "schemas" },
      { from: "../cpp/public/llvm-toolchain-sw.js", to: "./" },
    ],
    dataUriLimit: {
      assets: 0,
    },
  },
  tools: {
    rspack: {
      node: {
        __dirname: "mock",
        __filename: "mock",
      },
    },
  },
  server: {
    setup(context) {
      attachLlvmToolchainProxy(context.server.middlewares);
    },
  },
});
