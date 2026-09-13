import type { PackageManifest } from "./json";
import { BlockRegistry, defaultRegistry, LibraryApi } from "./registry";

export type FetchText = (url: string) => Promise<string>;

export type LibraryAssemblyModule = {
  install?: (api: LibraryApi) => void;
  default?: ((api: LibraryApi) => void) | { install?: (api: LibraryApi) => void };
};

export type ImportModule = (url: string) => Promise<LibraryAssemblyModule>;

export class AssemblyUrlResolver {
  private static readonly defaultInstance = new AssemblyUrlResolver();
  static get shared(): AssemblyUrlResolver {
    return this.defaultInstance;
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
  private static readonly defaultInstance = new LibraryAssemblyLoader();
  static get shared(): LibraryAssemblyLoader {
    return this.defaultInstance;
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
    if (typeof mod.install === "function") mod.install(api);
    else if (typeof mod.default === "function") mod.default(api);
    else if (mod.default && typeof mod.default === "object" && typeof mod.default.install === "function") mod.default.install(api);
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
    return JSON.parse(await fetchText(url)) as PackageManifest;
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

export const resolveUrl = (url: string, baseUrl?: string): string => AssemblyUrlResolver.shared.resolveUrl(url, baseUrl);
export const registerAssemblyUrl = (name: string, url: string): void => AssemblyUrlResolver.shared.register(name, url);
export const resolveAssemblyUrl = (url: string, baseUrl?: string): string => AssemblyUrlResolver.shared.resolve(url, baseUrl);
export const defaultFetchText = (url: string): Promise<string> => LibraryAssemblyLoader.shared.fetchText(url);
export const importAssembly = (url: string): Promise<LibraryAssemblyModule> => LibraryAssemblyLoader.shared.importAssembly(url);
export const importAssemblySource = (source: string): Promise<LibraryAssemblyModule> => LibraryAssemblyLoader.shared.importAssemblySource(source);
export const applyAssemblyModule = (mod: LibraryAssemblyModule, registry: BlockRegistry): void => LibraryAssemblyLoader.shared.apply(mod, registry);
export const installAssembly = (
  url: string,
  registry: BlockRegistry = defaultRegistry,
  importModule: ImportModule = importAssembly,
): Promise<void> => LibraryAssemblyLoader.shared.install(url, registry, importModule);
export const installAssemblySource = (source: string, registry: BlockRegistry = defaultRegistry): Promise<void> =>
  LibraryAssemblyLoader.shared.installSource(source, registry);
export const loadLibraryManifest = (url: string, fetchText: FetchText = defaultFetchText): Promise<PackageManifest> =>
  LibraryAssemblyLoader.shared.loadManifest(url, fetchText);
export const installLibraryFromUrl = (
  url: string,
  options: { fetchText?: FetchText; importModule?: ImportModule; registry?: BlockRegistry } = {},
): Promise<PackageManifest> => LibraryAssemblyLoader.shared.installFromUrl(url, options);
