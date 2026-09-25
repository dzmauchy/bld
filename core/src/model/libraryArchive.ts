/**
 * @title Library Archive
 *
 * A library archive is the tar.gz addressed by a library manifest location.
 * modern-tar unpacks the tar after gzip decompression.
 */
import { unpackTar } from "modern-tar";
import { loadAssetBytes } from "./appAssets";

const HEADER_NAME = /\.(?:h|hh|hpp|hxx)$/i;

export class LibraryArchive {
  private static readonly cached = new Map<string, Promise<LibraryArchive>>();

  private constructor(private readonly headerFiles: ReadonlyMap<string, string>) {}

  static async fetch(location: string): Promise<LibraryArchive> {
    const cached = LibraryArchive.cached.get(location);
    if (cached) return cached;
    const pending = LibraryArchive.load(location);
    LibraryArchive.cached.set(location, pending);
    pending.catch(() => {
      LibraryArchive.cached.delete(location);
    });
    return pending;
  }

  static async fromTarGz(bytes: Uint8Array | ArrayBuffer): Promise<LibraryArchive> {
    const encoded = copyBytes(bytes);
    const entries = await unpackTar(new Blob([encoded]).stream().pipeThrough(new DecompressionStream("gzip")));
    const files = new Map<string, string>();
    const decoder = new TextDecoder();
    for (const entry of entries) {
      if (!entry.data) continue;
      const name = headerPath(entry.header.name);
      if (!name || !HEADER_NAME.test(name)) continue;
      files.set(name, decoder.decode(entry.data));
    }
    if (files.size === 0) throw new Error("Library archive does not contain header files");
    return new LibraryArchive(files);
  }

  files(): Record<string, string> {
    return Object.fromEntries(this.headerFiles);
  }

  sources(): string[] {
    return [...this.headerFiles.values()];
  }

  private static async load(location: string): Promise<LibraryArchive> {
    let failure: unknown;
    for (const url of archiveUrls(location)) {
      try {
        return await LibraryArchive.fromTarGz(await loadAssetBytes(url));
      } catch (error) {
        failure = error;
      }
    }
    const message = failure instanceof Error ? failure.message : String(failure);
    throw new Error(`Failed to load library archive ${location}: ${message}`);
  }
}

function archiveUrls(location: string): string[] {
  const urls = [location];
  if (!URL.canParse(location)) return urls;
  const name = new URL(location).pathname.split("/").pop();
  if (name && name !== location) urls.push(name);
  return urls;
}

function headerPath(name: string): string {
  const cleaned = name.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
  if (!cleaned || cleaned.endsWith("/") || cleaned.split("/").includes("..")) return "";
  return cleaned;
}

function copyBytes(bytes: Uint8Array | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}
