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

  private constructor(private readonly headerFiles: ReadonlyMap<string, string>, readonly metadata: unknown) {}

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
    const entries = await readArchiveEntries(encoded);
    const files = new Map<string, string>();
    let metadata: unknown;
    const decoder = new TextDecoder();
    for (const entry of entries) {
      if (!entry.data) continue;
      const name = headerFileName(entry.header.name);
      if (name === "meta.json") metadata = JSON.parse(decoder.decode(entry.data));
      if (!name || !HEADER_NAME.test(name)) continue;
      files.set(name, decoder.decode(entry.data));
    }
    if (files.size === 0) throw new Error("Library archive does not contain header files");
    if (!metadata) throw new Error("Library archive is missing meta.json");
    return new LibraryArchive(files, metadata);
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

async function readArchiveEntries(encoded: Uint8Array<ArrayBuffer>): Promise<Awaited<ReturnType<typeof unpackTar>>> {
  const blob = new Blob([encoded]);
  try {
    return await unpackTar(blob.stream().pipeThrough(new DecompressionStream("gzip")));
  } catch (gzipError) {
    // Static servers treat a .gz name as Content-Encoding and inflate the body first.
    try {
      return await unpackTar(blob.stream());
    } catch {
      throw gzipError;
    }
  }
}

function archiveUrls(location: string): string[] {
  const urls = [location];
  if (!URL.canParse(location)) return urls;
  const name = new URL(location).pathname.split("/").pop();
  if (name && name !== location) {
    if (typeof window !== "undefined") urls.unshift(name);
    else urls.push(name);
  }
  return urls;
}

function headerFileName(name: string): string {
  const cleaned = name.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (cleaned.endsWith("/")) return "";
  if (cleaned.split("/").some((part) => part === "..") || cleaned.startsWith("/")) throw new Error("Invalid archive path");
  return cleaned;
}

function copyBytes(bytes: Uint8Array | ArrayBuffer): Uint8Array<ArrayBuffer> {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}
