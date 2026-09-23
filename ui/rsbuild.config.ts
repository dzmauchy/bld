import { defineConfig } from "@rsbuild/core";

/** C++ headers are bundled as text so the palette can enumerate library blocks. */
export const rawHeaderRule = {
  test: /\.hpp$/,
  resourceQuery: /raw/,
  type: "asset/source" as const,
};

export default defineConfig({
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
