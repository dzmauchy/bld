import { defineConfig } from "@rsbuild/core";
import { attachLlvmToolchainProxy } from "../ui/scripts/llvmToolchainProxyMiddleware.ts";

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
    dataUriLimit: {
      wasm: 0,
    },
  },
  server: {
    port: 3002,
    setup(context) {
      attachLlvmToolchainProxy(context.server.middlewares);
    },
  },
});
