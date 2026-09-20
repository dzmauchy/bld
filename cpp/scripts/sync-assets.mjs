import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Downloads in-browser clang/lld wasm glue from the llvm-project GitHub release.
 * https://github.com/dzmauchy/llvm-project/releases
 */
export class LlvmProjectReleaseAssets {
  static owner = "dzmauchy";
  static repo = "llvm-project";
  static tag = "clang-lld-wasm-latest";
  static files = Object.freeze(["clang.js", "clang.wasm", "lld.js", "lld.wasm", "sysroot.tgz"]);

  /**
   * @param {string} dest Directory that receives clang.js, clang.wasm, lld.js, lld.wasm, and sysroot.tgz.
   */
  constructor(dest) {
    this.dest = dest;
  }

  get releasePageUrl() {
    return `https://github.com/${LlvmProjectReleaseAssets.owner}/${LlvmProjectReleaseAssets.repo}/releases`;
  }

  assetUrl(name) {
    return `https://github.com/${LlvmProjectReleaseAssets.owner}/${LlvmProjectReleaseAssets.repo}/releases/download/${LlvmProjectReleaseAssets.tag}/${name}`;
  }

  async sync() {
    await mkdir(this.dest, { recursive: true });
    for (const name of LlvmProjectReleaseAssets.files) {
      await this.download(name);
    }
  }

  async download(name) {
    const url = this.assetUrl(name);
    const outPath = join(this.dest, name);
    console.log(`sync ${url}`);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`failed to download ${url}: ${response.status} ${response.statusText}`);
    }
    await pipeline(Readable.fromWeb(response.body), createWriteStream(outPath));
    const downloaded = await stat(outPath);
    console.log(`wrote ${name} (${downloaded.size} bytes)`);
  }
}

export async function syncCppAssets(dest = join(dirname(fileURLToPath(import.meta.url)), "../assets")) {
  await new LlvmProjectReleaseAssets(dest).sync();
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  await syncCppAssets();
}
