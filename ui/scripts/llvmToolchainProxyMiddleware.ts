import type { IncomingMessage, ServerResponse } from "node:http";

const releasePrefix = "https://github.com/dzmauchy/clang-wasm/releases/download/clang-23.1.2/";
const releaseFiles = new Set(["clang.js", "clang.wasm", "lld.js", "lld.wasm", "sysroot.tgz"]);

type ConnectMiddleware = (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void;

type MiddlewareHost = {
  use(fn: ConnectMiddleware): void;
};

type ReleaseAsset = { status: number; body: Buffer };
type AssetFetcher = (url: string) => Promise<Response>;
type RetryDelay = (milliseconds: number) => Promise<void>;

/** Shares downloads across browser workers and retains successful release assets for one hour. */
export class LlvmToolchainAssetCache {
  private readonly downloads = new Map<string, { expiresAt: number; result: Promise<ReleaseAsset> }>();

  constructor(
    private readonly fetchAsset: AssetFetcher = (url) => fetch(url),
    private readonly delay: RetryDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  get(name: string): Promise<ReleaseAsset> {
    if (!releaseFiles.has(name)) return Promise.reject(new Error("forbidden toolchain asset"));
    const cached = this.downloads.get(name);
    if (cached && cached.expiresAt > Date.now()) return cached.result;
    const result = this.download(name).then((asset) => {
      if (asset.status !== 200) this.downloads.delete(name);
      return asset;
    }).catch((error: unknown) => {
      this.downloads.delete(name);
      throw error;
    });
    this.downloads.set(name, { expiresAt: Date.now() + 3_600_000, result });
    return result;
  }

  private async download(name: string): Promise<ReleaseAsset> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await this.fetchAsset(`${releasePrefix}${name}`);
        const body = Buffer.from(await response.arrayBuffer());
        const transient = response.status === 408 || response.status === 429 || response.status >= 500;
        if (!transient || attempt === 2) return { status: response.status, body };
      } catch (error) {
        if (attempt === 2) throw error;
      }
      await this.delay(250 * 2 ** attempt);
    }
    throw new Error("toolchain download attempts exhausted");
  }
}

export function attachLlvmToolchainProxy(
  middlewares: MiddlewareHost,
  assets = new LlvmToolchainAssetCache(),
): void {
  middlewares.use((req, res, next) => {
    const host = req.headers.host ?? "localhost";
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (url.pathname !== "/llvm-toolchain-proxy") {
      next();
      return;
    }
    const target = url.searchParams.get("url") ?? "";
    const name = target.startsWith(releasePrefix) ? target.slice(releasePrefix.length) : "";
    if (!releaseFiles.has(name)) {
      res.statusCode = 403;
      res.end("forbidden toolchain url");
      return;
    }
    void assets.get(name).then((asset) => {
      res.statusCode = asset.status;
      const contentType = name.endsWith(".js") ? "text/javascript" : name.endsWith(".wasm") ? "application/wasm" : "application/gzip";
      res.setHeader("content-type", contentType);
      res.setHeader("cache-control", asset.status === 200 ? "private, max-age=3600" : "no-store");
      res.end(asset.body);
    }).catch((error: unknown) => {
      res.statusCode = 502;
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-type", "text/plain");
      const message = error instanceof Error ? error.message : String(error);
      res.end(`failed to download ${name} after 3 attempts: ${message}`);
    });
  });
}
