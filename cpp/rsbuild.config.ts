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
    scriptLoading: "module",
  },
  output: {
    module: true,
    overrideBrowserslist: ["chrome >= 154", "edge >= 154", "firefox >= 157", "safari >= 27"],
    distPath: {
      root: "dist/web",
    },
    dataUriLimit: {
    },
  },
  server: {
    port: 3002,
    setup(context) {
      attachLlvmToolchainProxy(context.server.middlewares);
    },
  },
});
