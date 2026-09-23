import type { PackageManifest } from "core";
import baseManifest from "core/assets/base.json?raw";
import bldHeader from "base/native/include/bld.hpp?raw";
import baseHeader from "base/native/src/base.hpp?raw";
import wasmHostHeader from "base/native/src/wasm_host.hpp?raw";

export class BundledLibrary {
  constructor(
    readonly id: string,
    private readonly manifestText: string,
    private readonly headerTexts: ReadonlyMap<string, string>,
  ) {}

  manifest(): PackageManifest {
    return JSON.parse(this.manifestText) as PackageManifest;
  }

  headerSources(): string[] {
    return this.manifest().headers.map((url) => {
      const source = this.headerTexts.get(url);
      if (source === undefined) throw new Error(`Library "${this.id}" is missing header "${url}"`);
      return source;
    });
  }

  assets(): Record<string, string> {
    return {
      [`${this.id}.json`]: this.manifestText,
      ...Object.fromEntries(this.headerTexts),
    };
  }
}

export class BundledLibraryRegistry {
  private static instance: BundledLibraryRegistry | undefined;

  static get shared(): BundledLibraryRegistry {
    return (this.instance ??= BundledLibraryRegistry.create());
  }

  private readonly libraries = new Map<string, BundledLibrary>();

  private constructor() {}

  private static create(): BundledLibraryRegistry {
    const registry = new BundledLibraryRegistry();
    registry.register(baseLibrary());
    return registry;
  }

  register(library: BundledLibrary): void {
    this.libraries.set(library.id, library);
  }

  get(id: string): BundledLibrary | undefined {
    return this.libraries.get(id);
  }

  require(id: string): BundledLibrary {
    const library = this.get(id);
    if (!library) throw new Error(`Library "${id}" is not bundled`);
    return library;
  }
}

function baseLibrary(): BundledLibrary {
  return new BundledLibrary(
    "base",
    baseManifest,
    new Map([
      ["base/native/include/bld.hpp", bldHeader],
      ["base/native/src/base.hpp", baseHeader],
      ["base/native/src/wasm_host.hpp", wasmHostHeader],
    ]),
  );
}
