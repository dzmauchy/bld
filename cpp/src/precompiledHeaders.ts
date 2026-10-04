import { isHeader, workPath } from "./paths.ts";

export interface HeaderFileStore {
  writeText(path: string, text: string): void;
}

/** A bounded cache of the current header bundle, kept outside Emscripten's disposable FS. */
export class PrecompiledHeaders {
  static readonly headerPath = "/pch/headers.hpp";
  static readonly outputPath = "/pch/headers.pch";
  private readonly headers: ReadonlyMap<string, string>;

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

  writeTo(store: HeaderFileStore): void {
    for (const [path, text] of this.headers) store.writeText(path, text);
    const includes = [...this.headers.keys()].sort().filter((path) => !path.endsWith(".inc"));
    store.writeText(PrecompiledHeaders.headerPath, includes.map((path) => `#include "${path}"`).join("\n") + "\n");
  }
}
