import type { PackageManifest } from "./json";
import { BlockRegistry, defaultRegistry, LibraryApi } from "./registry";

export type FetchText = (url: string) => Promise<string>;

export type LibraryAssemblyModule = {
  install?: (api: LibraryApi) => void;
  default?: ((api: LibraryApi) => void) | { install?: (api: LibraryApi) => void };
};

export type ImportModule = (url: string) => Promise<LibraryAssemblyModule>;

export class AssemblyUrlResolver {
  private static readonly _shared = new AssemblyUrlResolver();
  static get shared(): AssemblyUrlResolver {
    return this._shared;
  }

  private readonly assemblyAliases = new Map<string, string>();

  resolveUrl(url: string, baseUrl?: string): string {
    if (URL.canParse(url)) return url;
    if (baseUrl && URL.canParse(baseUrl)) return new URL(url, baseUrl).href;
    if (baseUrl) {
      const normalized = baseUrl.replace(/\\/g, "/");
      const slash = normalized.lastIndexOf("/");
      if (slash !== -1) return `${normalized.slice(0, slash + 1)}${url}`;
    }
    return url;
  }

  private basename(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    return slash === -1 ? normalized : normalized.slice(slash + 1);
  }

  register(name: string, url: string): void {
    this.assemblyAliases.set(name, url);
  }

  resolve(url: string, baseUrl?: string): string {
    const resolved = this.resolveUrl(url, baseUrl);
    const resolvedAlias = this.assemblyAliases.get(resolved);
    if (resolvedAlias) return resolvedAlias;
    if (!URL.canParse(resolved)) {
      const aliased = this.assemblyAliases.get(url) ?? this.assemblyAliases.get(this.basename(resolved));
      if (aliased) return aliased;
    }
    return resolved;
  }

  clear(): void {
    this.assemblyAliases.clear();
  }
}

export class LibraryAssemblyLoader {
  private static readonly _shared = new LibraryAssemblyLoader();
  static get shared(): LibraryAssemblyLoader {
    return this._shared;
  }

  constructor(private readonly resolver: AssemblyUrlResolver = AssemblyUrlResolver.shared) {}

  async fetchText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  async importAssembly(url: string): Promise<LibraryAssemblyModule> {
    return import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<LibraryAssemblyModule>;
  }

  async importAssemblySource(source: string): Promise<LibraryAssemblyModule> {
    const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
    return this.importAssembly(url);
  }

  apply(mod: LibraryAssemblyModule, registry: BlockRegistry): void {
    const api = new LibraryApi(registry);
    if (typeof mod.install === "function") {
      mod.install(api);
      return;
    }
    if (typeof mod.default === "function") {
      mod.default(api);
      return;
    }
    if (mod.default && typeof mod.default === "object" && typeof mod.default.install === "function") {
      mod.default.install(api);
    }
  }

  async install(
    url: string,
    registry: BlockRegistry = defaultRegistry,
    importModule: ImportModule = (u) => this.importAssembly(u),
  ): Promise<void> {
    const mod = await importModule(url);
    this.apply(mod, registry);
  }

  async installSource(
    source: string,
    registry: BlockRegistry = defaultRegistry,
  ): Promise<void> {
    const mod = await this.importAssemblySource(source);
    this.apply(mod, registry);
  }

  async loadManifest(
    url: string,
    fetchText: FetchText = (u) => this.fetchText(u),
  ): Promise<PackageManifest> {
    const text = await fetchText(url);
    return JSON.parse(text) as PackageManifest;
  }

  async installFromUrl(
    url: string,
    options: {
      fetchText?: FetchText;
      importModule?: ImportModule;
      registry?: BlockRegistry;
    } = {},
  ): Promise<PackageManifest> {
    const fetchText = options.fetchText ?? ((u) => this.fetchText(u));
    const importModule = options.importModule ?? ((u) => this.importAssembly(u));
    const registry = options.registry ?? defaultRegistry;
    const manifest = await this.loadManifest(url, fetchText);
    if (!manifest.assembly) return manifest;
    const assemblyUrl = this.resolver.resolve(manifest.assembly, url);
    await this.install(assemblyUrl, registry, importModule);
    return manifest;
  }
}

export function resolveUrl(url: string, baseUrl?: string): string {
  return AssemblyUrlResolver.shared.resolveUrl(url, baseUrl);
}

/** Map a relative assembly name (e.g. `assembly.js`) to an importable URL. */
export function registerAssemblyUrl(name: string, url: string): void {
  AssemblyUrlResolver.shared.register(name, url);
}

export function resolveAssemblyUrl(url: string, baseUrl?: string): string {
  return AssemblyUrlResolver.shared.resolve(url, baseUrl);
}

export async function defaultFetchText(url: string): Promise<string> {
  return LibraryAssemblyLoader.shared.fetchText(url);
}

/** Load a library JS file as an ES module. */
export async function importAssembly(url: string): Promise<LibraryAssemblyModule> {
  return LibraryAssemblyLoader.shared.importAssembly(url);
}

/** Dynamic-import ESM source when a URL is not available (tests / in-memory). */
export async function importAssemblySource(source: string): Promise<LibraryAssemblyModule> {
  return LibraryAssemblyLoader.shared.importAssemblySource(source);
}

export function applyAssemblyModule(mod: LibraryAssemblyModule, registry: BlockRegistry): void {
  LibraryAssemblyLoader.shared.apply(mod, registry);
}

export async function installAssembly(
  url: string,
  registry: BlockRegistry = defaultRegistry,
  importModule: ImportModule = importAssembly,
): Promise<void> {
  return LibraryAssemblyLoader.shared.install(url, registry, importModule);
}

export async function installAssemblySource(
  source: string,
  registry: BlockRegistry = defaultRegistry,
): Promise<void> {
  return LibraryAssemblyLoader.shared.installSource(source, registry);
}

export async function loadLibraryManifest(
  url: string,
  fetchText: FetchText = defaultFetchText,
): Promise<PackageManifest> {
  return LibraryAssemblyLoader.shared.loadManifest(url, fetchText);
}

export async function installLibraryFromUrl(
  url: string,
  options: {
    fetchText?: FetchText;
    importModule?: ImportModule;
    registry?: BlockRegistry;
  } = {},
): Promise<PackageManifest> {
  return LibraryAssemblyLoader.shared.installFromUrl(url, options);
}
