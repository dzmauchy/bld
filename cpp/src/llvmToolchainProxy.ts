import { LlvmProjectRelease } from "./llvmRelease.ts";

export const baseLibraryUrl = "https://github.com/dzmauchy/bld-base/releases/download/v0.1.0/base-0.1.0.tar.gz";
export const baseLibraryPath = baseLibraryUrl.slice(baseLibraryUrl.lastIndexOf("/"));

/**
 * Same-origin relay for the base library and clang/lld release assets.
 * GitHub release downloads omit CORS headers, so the browser service worker
 * forwards those URLs here and the server fetches them.
 */
export class LlvmToolchainProxy {
  static readonly path = "/llvm-toolchain-proxy";
  private readonly release: LlvmProjectRelease;

  constructor(release = new LlvmProjectRelease()) {
    this.release = release;
  }

  matches(url: URL): boolean {
    return url.pathname === LlvmToolchainProxy.path || url.pathname === baseLibraryPath;
  }

  async response(requestUrl: URL): Promise<Response> {
    const baseLibrary = requestUrl.pathname === baseLibraryPath;
    const target = baseLibrary ? baseLibraryUrl : requestUrl.searchParams.get("url") ?? "";
    if (!baseLibrary && !this.release.isToolchainAsset(target)) {
      return new Response("forbidden toolchain url", { status: 403 });
    }
    const upstream = await fetch(target);
    const name = baseLibrary ? baseLibraryPath : this.release.assetName(target);
    const headers = new Headers();
    headers.set("content-type", this.release.contentType(name));
    headers.set("cache-control", upstream.ok ? "private, max-age=3600" : "no-store");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }
}
