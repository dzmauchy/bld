import { TarArchive } from "./tarArchive.mjs";
import type { VirtualFileSystem } from "./filesystem.ts";

const LIBRARY_NAME = /\.(a|o)$/;

export function tarPathToMemfs(name: string): string {
  const cleaned = name.replaceAll("\\", "/").replace(/^\.\/+/, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

export function shouldInstallSysrootEntry(name: string): boolean {
  const normalized = name.replaceAll("\\", "/").replace(/^\.\/+/, "");
  return normalized.startsWith("sysroot/") && !normalized.split("/").includes("..")
    && !normalized.endsWith("/")
    && (normalized.includes("/include/") || LIBRARY_NAME.test(normalized));
}

export class SysrootInstaller {
  constructor(private readonly fs: VirtualFileSystem) {}

  async install(
    archive: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
    compressed = true,
  ): Promise<number> {
    const unpacked = await TarArchive.read(archive, compressed);
    let files = 0;
    for (const entry of unpacked.files()) {
      if (!shouldInstallSysrootEntry(entry.name)) continue;
      const path = tarPathToMemfs(entry.name);
      this.fs.writeTree(path, entry.data);
      files += 1;
    }
    return files;
  }
}
