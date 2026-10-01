import { isHeader, workPath } from "./paths.ts";

export interface HeaderFileStore {
  writeText(path: string, text: string): void;
  writeBytes(path: string, bytes: Uint8Array): void;
}

/**
 * The current header bundle. Without PROXYFS the `.pch` bytes are cached here;
 * with PROXYFS the file stays on the retained clang module.
 */
export class PrecompiledHeaders {
  static readonly headerPath = "/pch/headers.hpp";
  static readonly outputPath = "/pch/headers.pch";
  private readonly headers: ReadonlyMap<string, string>;
  private readonly files = new Map<string, Uint8Array>();

  constructor(files: ReadonlyMap<string, string>) {
    this.headers = new Map([...files].filter(([name]) => isHeader(name)).map(([name, text]) => [workPath(name), text]));
  }

  get empty(): boolean {
    return this.headers.size === 0;
  }

  matches(files: ReadonlyMap<string, string>): boolean {
    const headers = [...files].filter(([name]) => isHeader(name));
    return headers.length === this.headers.size && headers.every(([name, text]) => this.headers.get(workPath(name)) === text);
  }

  capture(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes.slice());
  }

  restore(store: HeaderFileStore): void {
    for (const [path, text] of this.headers) store.writeText(path, text);
    const includes = [...this.headers.keys()].sort().filter((path) => !path.endsWith(".inc"));
    store.writeText(PrecompiledHeaders.headerPath, includes.map((path) => `#include "${path}"`).join("\n") + "\n");
    for (const [path, bytes] of this.files) store.writeBytes(path, bytes);
  }
}
