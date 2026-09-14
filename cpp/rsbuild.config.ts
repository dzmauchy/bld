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
      "clang-emscripten": path.join(root, "assets/clang.js"),
      "lld-emscripten": path.join(root, "assets/lld.js"),
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
  tools: {
    rspack: {
      resolve: {
        alias: {
          "clang-emscripten": path.join(root, "assets/clang.js"),
          "lld-emscripten": path.join(root, "assets/lld.js"),
        },
      },
      module: {
        rules: [
          {
            test: /\.tgz$/,
            type: "asset/resource",
          },
        ],
      },
    },
  },
  server: {
    port: 3002,
  },
});
