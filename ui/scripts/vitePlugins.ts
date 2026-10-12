import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";
import { schemaAssetFiles } from "../../core/src/schemaAssets.ts";
import { attachLlvmToolchainProxy } from "./llvmToolchainProxyMiddleware.ts";

export const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/** Publish shared schemas and the toolchain service worker in both Vite apps. */
export function workspaceAssets(includeSchemas = false): Plugin {
  const assets = new Map<string, URL>([
    ["llvm-toolchain-sw.js", new URL("../../cpp/public/llvm-toolchain-sw.js", import.meta.url)],
  ]);
  if (includeSchemas) {
    for (const name of schemaAssetFiles) assets.set(`schemas/${name}`, new URL(`../../core/assets/schemas/${name}`, import.meta.url));
  }
  return {
    name: "bld-workspace-assets",
    async generateBundle() {
      for (const [fileName, url] of assets) this.emitFile({ type: "asset", fileName, source: await readFile(url) });
    },
    configureServer(server) {
      attachLlvmToolchainProxy(server.middlewares);
      server.middlewares.use((request, response, next) => {
        const url = assets.get((request.url ?? "").split("?")[0]!.slice(1));
        if (!url) { next(); return; }
        void readFile(url).then((bytes) => {
          response.setHeader("content-type", url.pathname.endsWith(".json") ? "application/json" : "text/javascript");
          response.end(bytes);
        }).catch(next);
      });
    },
    configurePreviewServer(server) {
      attachLlvmToolchainProxy(server.middlewares);
    },
  };
}
