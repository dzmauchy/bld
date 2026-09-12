import type { DiagramJson, PackageManifest, WasmProfileName } from "./json";
import type { CompileOptions, WasmProgram } from "./program";
import { BlockRegistry, defaultRegistry } from "./registry";
import { LibraryApi } from "./dsl";
import { planDiagramJson } from "./plan";
import { getWasmProfile } from "./profile";
import { compileBrowserProgram, emitBrowserText } from "./compile";

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
  return import(/* @vite-ignore */ url) as Promise<LibraryAssemblyModule>;
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

export type CompileRequest = {
  diagram: DiagramJson;
  /** URLs of `library.schema.json` manifests. */
  libraries: string[];
  profile?: WasmProfileName;
  optimizeLevel?: number;
  debug?: boolean;
  fetchText?: FetchText;
  registry?: BlockRegistry;
};

async function registryForRequest(request: CompileRequest): Promise<BlockRegistry> {
  if (request.registry) return request.registry;
  const registry = new BlockRegistry();
  for (const url of request.libraries) {
    if (request.fetchText) {
      await installLibraryFromUrl(url, { fetchText: request.fetchText, registry });
    } else {
      await installLibraryFromUrl(url, { registry });
    }
  }
  return registry;
}

function compileOptions(request: CompileRequest): CompileOptions {
  const options: CompileOptions = {};
  if (request.debug !== undefined) options.debug = request.debug;
  if (request.optimizeLevel !== undefined) options.optimizeLevel = request.optimizeLevel;
  return options;
}

export async function compileDiagram(request: CompileRequest): Promise<Uint8Array> {
  const profile = getWasmProfile(request.profile ?? "browser");
  const registry = await registryForRequest(request);
  const program = planDiagramJson(request.diagram, registry);
  if (profile.name === "browser") {
    return compileBrowserProgram(program, { ...compileOptions(request), registry });
  }
  return profile.compile(program, compileOptions(request));
}

export async function emitDiagramText(request: CompileRequest): Promise<string> {
  const profile = getWasmProfile(request.profile ?? "browser");
  const registry = await registryForRequest(request);
  const program = planDiagramJson(request.diagram, registry);
  if (profile.name === "browser") {
    return emitBrowserText(program, { ...compileOptions(request), registry });
  }
  return profile.emitText(program, compileOptions(request));
}

export function compileProgram(program: WasmProgram, options: CompileOptions & { registry?: BlockRegistry } = {}): Uint8Array {
  const profile = getWasmProfile("browser");
  return profile.compile(program, options);
}
