import { unpackTar } from "modern-tar";
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
    const input = asByteStream(archive);
    const gzip = new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
    const source = compressed ? input.pipeThrough(gzip) : input;
    const unpacked = await unpackTar(source, {
      filter: (header) => header.type !== "directory" && shouldInstallSysrootEntry(header.name),
    });
    let files = 0;
    for (const entry of unpacked) {
      if (!entry.data) continue;
      const path = tarPathToMemfs(entry.header.name);
      this.fs.writeTree(path, entry.data);
      files += 1;
    }
    return files;
  }
}

function asByteStream(
  archive: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  if (archive instanceof ReadableStream) return archive;
  return new Blob([copyBytes(archive)]).stream();
}

function copyBytes(archive: ArrayBuffer | Uint8Array): Uint8Array<ArrayBuffer> {
  const source = archive instanceof Uint8Array ? archive : new Uint8Array(archive);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}
