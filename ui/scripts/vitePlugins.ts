import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";
import { schemaAssetFiles } from "core/schemaAssets.ts";
import { LlvmProjectRelease } from "cpp/llvmRelease.ts";
import { attachLlvmToolchainProxy } from "./llvmToolchainProxyMiddleware.ts";

export const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

/** An asset served by Vite in development and emitted with each production build. */
class WorkspaceAsset {
  constructor(readonly path: string, private readonly url: URL) {}

  source(): Promise<string> {
    return readFile(this.url, "utf8");
  }

  get contentType(): string {
    return this.path.endsWith(".json") ? "application/json" : "text/javascript";
  }
}

/** Generates a classic service worker using the same release as the compiler and proxy. */
export class ToolchainServiceWorkerAsset extends WorkspaceAsset {
  constructor(private readonly release = new LlvmProjectRelease()) {
    super("llvm-toolchain-sw.js", new URL("../../cpp/assets/llvm-toolchain-sw.js", import.meta.url));
  }

  override async source(): Promise<string> {
    return `const releasePrefix = ${JSON.stringify(this.release.assetUrl(""))};\n`
      + `const releaseFiles = new Set(${JSON.stringify(LlvmProjectRelease.files)});\n`
      + await super.source();
  }
}

/** Publish shared schemas and the toolchain service worker in both Vite apps. */
export function workspaceAssets(includeSchemas = false): Plugin {
  const serviceWorker = new ToolchainServiceWorkerAsset();
  const assets = new Map<string, WorkspaceAsset>([[serviceWorker.path, serviceWorker]]);
  if (includeSchemas) {
    for (const name of schemaAssetFiles) {
      const asset = new WorkspaceAsset(`schemas/${name}`, new URL(`../../core/assets/schemas/${name}`, import.meta.url));
      assets.set(asset.path, asset);
    }
  }
  return {
    name: "bld-workspace-assets",
    async generateBundle() {
      for (const [fileName, asset] of assets) this.emitFile({ type: "asset", fileName, source: await asset.source() });
    },
    configureServer(server) {
      attachLlvmToolchainProxy(server.middlewares);
      server.middlewares.use((request, response, next) => {
        const asset = assets.get((request.url ?? "").split("?")[0]!.slice(1));
        if (!asset) { next(); return; }
        void asset.source().then((bytes) => {
          response.setHeader("content-type", asset.contentType);
          response.end(bytes);
        }).catch(next);
      });
    },
    configurePreviewServer(server) {
      attachLlvmToolchainProxy(server.middlewares);
    },
  };
}
