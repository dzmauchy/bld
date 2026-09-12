import type { PackageManifest } from "./json";
import { BlockRegistry, defaultRegistry, LibraryApi } from "./registry";

export type FetchText = (url: string) => Promise<string>;

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

export async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export type LibraryAssemblyModule = {
  install?: (api: LibraryApi) => void;
  default?: ((api: LibraryApi) => void) | { install?: (api: LibraryApi) => void };
};

export async function importAssemblySource(source: string): Promise<LibraryAssemblyModule> {
  const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}`;
  return import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<LibraryAssemblyModule>;
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
  options: { fetchText?: FetchText; registry?: BlockRegistry } = {},
): Promise<PackageManifest> {
  const fetchText = options.fetchText ?? defaultFetchText;
  const registry = options.registry ?? defaultRegistry;
  const manifest = await loadLibraryManifest(url, fetchText);
  if (!manifest.assembly) return manifest;
  const assemblyUrl = resolveUrl(manifest.assembly, url);
  const source = await fetchText(assemblyUrl);
  await installAssemblySource(source, registry);
  return manifest;
}
