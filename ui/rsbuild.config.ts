import { defineConfig } from "@rsbuild/core";
import { pluginSolid } from "@rsbuild/plugin-solid";

/** C++ headers are bundled as text so the palette can enumerate library blocks. */
export const rawHeaderRule = {
  test: /\.hpp$/,
  resourceQuery: /raw/,
  type: "asset/source" as const,
};

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
  },
  tools: {
    rspack: {
      module: {
        rules: [rawHeaderRule],
      },
      node: {
        __dirname: "mock",
        __filename: "mock",
      },
    },
  },
});
