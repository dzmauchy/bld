import type { FullConfig } from "@playwright/test";
import { LlvmProjectRelease } from "cpp/llvmRelease.ts";

/** Fills the running preview server's asset cache before browser workers start. */
export class LlvmToolchainPrecache {
  constructor(
    private readonly baseURL: string,
    private readonly fetchAsset: (url: URL) => Promise<Response> = (url) => fetch(url),
    private readonly release = new LlvmProjectRelease(),
  ) {}

  async preload(): Promise<void> {
    const results = await Promise.allSettled(LlvmProjectRelease.files.map((name) => this.download(name)));
    const failures = results.flatMap((result) => result.status === "rejected"
      ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []);
    if (failures.length) throw new Error(failures.join("\n"));
  }

  private async download(name: string): Promise<void> {
    const url = new URL("/llvm-toolchain-proxy", this.baseURL);
    url.searchParams.set("url", this.release.assetUrl(name));
    try {
      const response = await this.fetchAsset(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      await response.arrayBuffer();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to precache ${name}: ${message}`, { cause: error });
    }
  }
}

export default async function precacheLlvmToolchain(config: FullConfig): Promise<void> {
  const baseURLs = new Set(config.projects.map((project) => project.use.baseURL).filter((url) => url !== undefined));
  if (!baseURLs.size) throw new Error("toolchain precache requires a Playwright baseURL");
  for (const baseURL of baseURLs) {
    console.log(`Precaching LLVM toolchain assets through ${baseURL}`);
    await new LlvmToolchainPrecache(baseURL).preload();
    console.log(`LLVM toolchain cached: ${LlvmProjectRelease.files.join(", ")}`);
  }
}
