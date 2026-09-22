import { defineConfig } from "@rsbuild/core";

export default defineConfig({
  output: {
    copy: [{ from: "../core/assets/schemas", to: "schemas" }],
  },
  tools: {
    rspack: {
      node: {
        __dirname: "mock",
        __filename: "mock",
      },
      resolve: {
        // web-tree-sitter mentions fs and path only inside its Node startup
        // branch. This UI bundle is browser-only, so those builtins stay empty
        // instead of being polyfilled.
        fallback: {
          fs: false,
          path: false,
        },
      },
    },
  },
});
