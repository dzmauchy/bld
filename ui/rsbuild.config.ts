import { defineConfig } from "@rsbuild/core";
import { pluginSolid } from "@rsbuild/plugin-solid";
import { attachLlvmToolchainProxy } from "./scripts/llvmToolchainProxyMiddleware.ts";

export default defineConfig({
  // @rsbuild/plugin-solid compiles JSX with @solidjs/compiler 2.0.0-rc.9,
  // matching solid-js and @solidjs/web, so delegated handlers use `_$$click`.
  plugins: [pluginSolid()],
  source: {
    entry: {
      index: "./src/index.tsx",
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
