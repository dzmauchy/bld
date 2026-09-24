import { LlvmProjectRelease } from "./llvmRelease.ts";

/**
 * Same-origin relay for the clang/lld release assets.
 * GitHub release downloads omit CORS headers, so the browser service worker
 * forwards those URLs here and the server fetches them.
 */
export class LlvmToolchainProxy {
  static readonly path = "/llvm-toolchain-proxy";

  constructor(private readonly release = new LlvmProjectRelease()) {}

  matches(url: URL): boolean {
    return url.pathname === LlvmToolchainProxy.path;
  }

  async response(requestUrl: URL): Promise<Response> {
    const target = requestUrl.searchParams.get("url") ?? "";
    if (!this.release.isToolchainAsset(target)) {
      return new Response("forbidden toolchain url", { status: 403 });
    }
    const upstream = await fetch(target);
    const name = this.release.assetName(target);
    const headers = new Headers();
    headers.set("content-type", name.endsWith(".js") ? "text/javascript" : "application/wasm");
    headers.set("cache-control", "private, max-age=3600");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }
}
