import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@rsbuild/core";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  source: {
    entry: {
      index: "./src/browser/index.ts",
    },
    alias: {
      "clang-emscripten": path.join(root, "vendor/clang.js"),
      "lld-emscripten": path.join(root, "vendor/lld.js"),
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
    copy: [{ from: "vendor", to: "toolchain" }],
  },
  tools: {
    rspack: {
      resolve: {
        alias: {
          "clang-emscripten": path.join(root, "vendor/clang.js"),
          "lld-emscripten": path.join(root, "vendor/lld.js"),
        },
      },
    },
  },
  server: {
    port: 3002,
  },
});
