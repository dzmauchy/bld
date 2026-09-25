/**
 * In-browser clang/lld binaries published by llvm-project.
 * https://github.com/dzmauchy/llvm-project/releases/tag/clang-lld-wasm-latest
 */
export class LlvmProjectRelease {
  static readonly owner = "dzmauchy";
  static readonly repo = "llvm-project";
  static readonly tag = "clang-lld-wasm-latest";
  static readonly files = Object.freeze(["clang.js", "clang.wasm.gz", "lld.js", "lld.wasm.gz", "sysroot.tgz"] as const);

  releasePageUrl(): string {
    return `https://github.com/${LlvmProjectRelease.owner}/${LlvmProjectRelease.repo}/releases/tag/${LlvmProjectRelease.tag}`;
  }

  assetUrl(name: string): string {
    return `https://github.com/${LlvmProjectRelease.owner}/${LlvmProjectRelease.repo}/releases/download/${LlvmProjectRelease.tag}/${name}`;
  }

  contentType(name: string): string {
    if (name.endsWith(".js")) return "text/javascript";
    if (name.endsWith(".wasm")) return "application/wasm";
    return "application/gzip";
  }

  isToolchainAsset(url: string): boolean {
    return (LlvmProjectRelease.files as readonly string[]).includes(this.assetName(url));
  }

  assetName(url: string): string {
    if (!URL.canParse(url)) return "";
    const parsed = new URL(url);
    const prefix = `/dzmauchy/llvm-project/releases/download/${LlvmProjectRelease.tag}/`;
    if (parsed.origin !== "https://github.com" || !parsed.pathname.startsWith(prefix)) return "";
    return parsed.pathname.slice(prefix.length);
  }
}
