import { unpackTar } from "modern-tar";
import type { VirtualFileSystem } from "./filesystem.ts";
import type { SysrootInstallKind } from "./messages.ts";

const HEADER_NAME = /\.(h|hh|hpp|hxx|inc|def)$/;
const LIBRARY_NAME = /\.(a|o)$/;

export function tarPathToMemfs(name: string): string {
  const cleaned = name.replaceAll("\\", "/").replace(/^\.\/+/, "");
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

export function shouldInstallSysrootEntry(name: string, kind: SysrootInstallKind): boolean {
  const normalized = name.replaceAll("\\", "/");
  if (!normalized.startsWith("sysroot/") || normalized.endsWith("/")) return false;
  if (kind === "headers") {
    return normalized.includes("/include/") || HEADER_NAME.test(normalized);
  }
  return normalized.includes("/lib/") && LIBRARY_NAME.test(normalized);
}

export class SysrootInstaller {
  constructor(private readonly fs: VirtualFileSystem) {}

  async install(
    archive: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
    kind: SysrootInstallKind,
    compressed = true,
  ): Promise<{ files: number; resourceDir: string }> {
    const source = compressed ? await inflateGzip(archive) : await readBytes(archive);
    const entries = await unpackTar(source, {
      filter: (header) => header.type !== "directory" && shouldInstallSysrootEntry(header.name, kind),
    });
    let files = 0;
    for (const entry of entries) {
      if (!entry.data) continue;
      this.fs.writeTree(tarPathToMemfs(entry.header.name), entry.data);
      files += 1;
    }
    return { files, resourceDir: this.detectResourceDir() };
  }

  detectResourceDir(): string {
    const base = "/sysroot/lib/clang";
    if (!this.fs.exists(base) || !this.fs.isDirectory(base)) return base;
    const versions = this.fs.list(base).filter((name) => name !== "." && name !== "..");
    const version = versions[0];
    return version ? `${base}/${version}` : base;
  }
}

async function inflateGzip(
  archive: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const input = asByteStream(archive);
  const decompressor = new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  return new Uint8Array(await new Response(input.pipeThrough(decompressor)).arrayBuffer());
}

async function readBytes(
  archive: ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  if (archive instanceof ReadableStream) return new Uint8Array(await new Response(archive).arrayBuffer());
  return copyBytes(archive);
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
