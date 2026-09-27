import { LlvmToolchainProxy } from "../cpp/src/llvmToolchainProxy.ts";

type AssetFetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export type AssetEnv = {
  ASSETS: AssetFetcher;
};

const toolchainProxy = new LlvmToolchainProxy();

export default {
  async fetch(request: Request, env: AssetEnv): Promise<Response> {
    const url = new URL(request.url);
    if (toolchainProxy.matches(url)) return toolchainProxy.response(url);

    return env.ASSETS.fetch(request);
  },
};

