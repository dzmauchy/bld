import { LlvmToolchainProxy } from "../cpp/src/llvmToolchainProxy.ts";
import { PrecompressedWasmDelivery } from "../ui/src/deploy/precompressedWasmDelivery.ts";

type AssetFetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type AssetEnv = {
  ASSETS: AssetFetcher;
};

const delivery = new PrecompressedWasmDelivery();
const toolchainProxy = new LlvmToolchainProxy();

export default {
  async fetch(request: Request, env: AssetEnv): Promise<Response> {
    const url = new URL(request.url);
    if (toolchainProxy.matches(url)) return toolchainProxy.response(url);

    const pathname = url.pathname;
    if (!pathname.endsWith(".wasm")) return env.ASSETS.fetch(request);

    const asset = await env.ASSETS.fetch(request);
    if (!asset.body) return asset;

    const { prefix, stream } = await delivery.splitPrefix(asset.body);
    if (!delivery.shouldServeAsBrotli(pathname, asset.status, prefix)) {
      return new Response(stream, {
        status: asset.status,
        statusText: asset.statusText,
        headers: asset.headers,
      });
    }

    return new Response(stream, {
      status: asset.status,
      statusText: asset.statusText,
      headers: delivery.brotliHeaders(asset.headers),
      encodeBody: "manual",
    });
  },
};
