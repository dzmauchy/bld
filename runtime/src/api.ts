import type { PackageManifest } from "./json";
import { BlockRegistry, defaultRegistry, LibraryApi } from "./registry";

export type FetchText = (url: string) => Promise<string>;

export type LibraryAssemblyModule = {
  install?: (api: LibraryApi) => void;
  default?: ((api: LibraryApi) => void) | { install?: (api: LibraryApi) => void };
};

export type ImportModule = (url: string) => Promise<LibraryAssemblyModule>;

const assemblyAliases = new Map<string, string>();

export function resolveUrl(url: string, baseUrl?: string): string {
  if (URL.canParse(url)) return url;
  if (baseUrl && URL.canParse(baseUrl)) return new URL(url, baseUrl).href;
  if (baseUrl) {
    const normalized = baseUrl.replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    if (slash !== -1) return `${normalized.slice(0, slash + 1)}${url}`;
  }
  return url;
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash === -1 ? normalized : normalized.slice(slash + 1);
}

/** Map a relative assembly name (e.g. `assembly.js`) to an importable URL. */
export function registerAssemblyUrl(name: string, url: string): void {
  assemblyAliases.set(name, url);
}

export function resolveAssemblyUrl(url: string, baseUrl?: string): string {
  const aliased = assemblyAliases.get(url);
  if (aliased) return aliased;
  const resolved = resolveUrl(url, baseUrl);
  const resolvedAlias = assemblyAliases.get(resolved);
  if (resolvedAlias) return resolvedAlias;
  if (!URL.canParse(resolved)) {
    const named = assemblyAliases.get(basename(resolved));
    if (named) return named;
  }
  return resolved;
}

export async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/** Load a library JS file as an ES module. */
export async function importAssembly(url: string): Promise<LibraryAssemblyModule> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<LibraryAssemblyModule>;
}

/** Dynamic-import ESM source when a URL is not available (tests / in-memory). */
export async function importAssemblySource(source: string): Promise<LibraryAssemblyModule> {
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
  return importAssembly(url);
}

export function applyAssemblyModule(mod: LibraryAssemblyModule, registry: BlockRegistry): void {
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

export async function installAssembly(
  url: string,
  registry: BlockRegistry = defaultRegistry,
  importModule: ImportModule = importAssembly,
): Promise<void> {
  const mod = await importModule(url);
  applyAssemblyModule(mod, registry);
}

export async function installAssemblySource(
  source: string,
  registry: BlockRegistry = defaultRegistry,
): Promise<void> {
  const mod = await importAssemblySource(source);
  applyAssemblyModule(mod, registry);
}

export async function loadLibraryManifest(
  url: string,
  fetchText: FetchText = defaultFetchText,
): Promise<PackageManifest> {
  const text = await fetchText(url);
  return JSON.parse(text) as PackageManifest;
}

export async function installLibraryFromUrl(
  url: string,
  options: {
    fetchText?: FetchText;
    importModule?: ImportModule;
    registry?: BlockRegistry;
  } = {},
): Promise<PackageManifest> {
  const fetchText = options.fetchText ?? defaultFetchText;
  const importModule = options.importModule ?? importAssembly;
  const registry = options.registry ?? defaultRegistry;
  const manifest = await loadLibraryManifest(url, fetchText);
  if (!manifest.assembly) return manifest;
  const assemblyUrl = resolveAssemblyUrl(manifest.assembly, url);
  await installAssembly(assemblyUrl, registry, importModule);
  return manifest;
}
