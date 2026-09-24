import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@rsbuild/core";
import { pluginSolid } from "@rsbuild/plugin-solid";

const cppAssets = path.join(path.dirname(fileURLToPath(import.meta.url)), "../cpp/assets");

export default defineConfig({
  // Compiler is pinned to the same Solid 2.0 RC as solid-js and @solidjs/web
  // so delegated handlers are stored on `_$$click`.
  plugins: [pluginSolid()],
  source: {
    entry: {
      index: "./src/index.tsx",
    },
  },
  html: {
    template: "./index.html",
  },
  output: {
    copy: [{ from: "../core/assets/schemas", to: "schemas" }],
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
      resolve: {
        alias: {
          "clang-emscripten": path.join(cppAssets, "clang.js"),
          "lld-emscripten": path.join(cppAssets, "lld.js"),
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
});
