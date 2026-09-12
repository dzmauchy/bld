/**
 * @title Library
 */
import { TypeSystem, type TypeCatalogEntry } from "../types";
import { BlockDefinition, type RawBlockCatalogEntry } from "./blockDefinition";
import { Palette } from "./palette";
import { CompilationModel } from "./compiler";

export function isRelativeUrl(url: string): boolean {
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) && !url.startsWith("//");
}

export function normalizeAssetPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
}

export function resolveUrl(url: string, baseUrl?: string): string {
  if (!baseUrl || !isRelativeUrl(url)) {
    return url;
  }
  if (!isRelativeUrl(baseUrl)) {
    try {
      return new URL(url, baseUrl).href;
    } catch {
      return url;
    }
  }
  const baseDir = baseUrl.includes("/") ? baseUrl.slice(0, baseUrl.lastIndexOf("/") + 1) : "";
  return normalizeAssetPath(`${baseDir}${url}`);
}

export type AssetResolver = (path: string) => Promise<string> | string;

const registeredAssets = new Map<string, string>();
let customResolver: AssetResolver | null = null;

export function registerAppAsset(path: string, content: string): void {
  const norm = normalizeAssetPath(path);
  registeredAssets.set(norm, content);
  const slash = norm.lastIndexOf("/");
  if (slash !== -1) {
    const base = norm.slice(slash + 1);
    if (!registeredAssets.has(base)) {
      registeredAssets.set(base, content);
    }
  }
}

export function registerAppAssets(assets: Record<string, string>): void {
  for (const [p, c] of Object.entries(assets)) {
    registerAppAsset(p, c);
  }
}

export function getRegisteredAppAsset(path: string): string | undefined {
  const norm = normalizeAssetPath(path);
  if (registeredAssets.has(norm)) return registeredAssets.get(norm);
  const slash = norm.lastIndexOf("/");
  if (slash !== -1) {
    const base = norm.slice(slash + 1);
    if (registeredAssets.has(base)) return registeredAssets.get(base);
  }
  return undefined;
}

export function clearRegisteredAppAssets(): void {
  registeredAssets.clear();
}

export function setAppAssetResolver(resolver: AssetResolver | null): void {
  customResolver = resolver;
}

declare const process: {
  versions?: { node?: string };
  cwd?: () => string;
  getBuiltinModule?: (name: string) => unknown;
} | undefined;

function readNodeAsset(cleanPath: string): string | null {
  const proc = typeof process !== "undefined" ? process : undefined;
  if (proc?.versions?.node && typeof proc.getBuiltinModule === "function") {
    try {
      const fs = proc.getBuiltinModule("node:fs") as { readFileSync: (p: string, enc: string) => string } | undefined;
      const path = proc.getBuiltinModule("node:path") as { join: (...args: string[]) => string; dirname: (p: string) => string } | undefined;
      const url = proc.getBuiltinModule("node:url") as { fileURLToPath: (url: string | URL) => string } | undefined;

      if (!fs || !path || !url) return null;

      const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
      const cwd = proc.cwd?.() ?? "";
      const candidates = [
        path.join(currentDir, "../../assets", cleanPath),
        path.join(currentDir, "../../../core/assets", cleanPath),
        path.join(cwd, "assets", cleanPath),
        path.join(cwd, "core/assets", cleanPath),
      ];

      for (const p of candidates) {
        try {
          return fs.readFileSync(p, "utf8");
        } catch {
          // Continue to next candidate
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export async function loadAsset(url: string, baseUrl?: string): Promise<string> {
  const resolved = resolveUrl(url, baseUrl);

  if (!isRelativeUrl(resolved)) {
    return fetchText(resolved);
  }

  // Relative URLs are assets of the app
  const cleanPath = normalizeAssetPath(resolved);

  if (customResolver) {
    const result = await customResolver(cleanPath);
    if (result !== undefined && result !== null) return result;
  }

  const registered = getRegisteredAppAsset(cleanPath);
  if (registered !== undefined) {
    return registered;
  }

  const nodeContent = await readNodeAsset(cleanPath);
  if (nodeContent !== null) {
    return nodeContent;
  }

  // In browser, fetch as app asset
  if (typeof fetch === "function") {
    const candidates = [
      `/assets/${cleanPath}`,
      `/${cleanPath}`,
      cleanPath,
    ];
    for (const c of candidates) {
      try {
        const res = await fetch(c);
        if (res.ok) {
          return await res.text();
        }
      } catch {
        // Try next candidate
      }
    }
  }

  throw new Error(`App asset not found: ${cleanPath}`);
}

export interface PackageManifest {
  $schema?: string;
  id: string;
  name: string;
  icon?: string;
  types?: string[];
  namespaces?: string[];
  blocks?: string[];
  assembly?: string[];
}

export interface LibrarySources {
  types?: Record<string, TypeCatalogEntry>;
  namespaces?: Record<string, unknown>;
  blocks?: Record<string, RawBlockCatalogEntry>;
  assemblyFiles?: Record<string, string>;
}

export class Library {
  static base: Library | undefined;

  constructor(
    readonly manifest: PackageManifest,
    readonly typeSystem: TypeSystem,
    readonly palette: Palette,
    readonly compilationModel: CompilationModel,
    readonly types: Record<string, TypeCatalogEntry> = {},
    readonly namespaces: Record<string, unknown> = {},
    readonly blocks: Record<string, RawBlockCatalogEntry> = {},
    readonly assemblyFiles: Record<string, string> = {},
  ) {}

  get id(): string {
    return this.manifest.id;
  }

  get name(): string {
    return this.manifest.name;
  }

  get icon(): string | undefined {
    return this.manifest.icon;
  }

  static fromManifest(manifest: PackageManifest, sources: LibrarySources = {}): Library {
    const types = sources.types ?? {};
    const namespaces = sources.namespaces ?? {};
    const blocks = sources.blocks ?? {};
    const assemblyFiles = sources.assemblyFiles ?? {};

    const typeSystem = TypeSystem.fromCatalog(types);
    const palette = new Palette(typeSystem, namespaces);

    for (const [id, raw] of Object.entries(blocks)) {
      if (id === "$schema") continue;
      palette.registerBlock(BlockDefinition.fromRaw(id, raw, typeSystem));
    }

    const compilationModel = new CompilationModel(assemblyFiles);

    const lib = new Library(
      manifest,
      typeSystem,
      palette,
      compilationModel,
      types,
      namespaces,
      blocks,
      assemblyFiles,
    );

    if (manifest.id === "base") {
      Library.base = lib;
    }

    return lib;
  }

  static async load(manifestOrUrl: string | PackageManifest, baseUrl?: string): Promise<Library> {
    let manifest: PackageManifest;
    let effectiveBaseUrl = baseUrl;

    if (typeof manifestOrUrl === "string") {
      const manifestText = await loadAsset(manifestOrUrl, baseUrl);
      manifest = JSON.parse(manifestText) as PackageManifest;
      effectiveBaseUrl = manifestOrUrl;
    } else {
      manifest = manifestOrUrl;
    }

    const allTypes: Record<string, TypeCatalogEntry> = {};
    const allNamespaces: Record<string, unknown> = {};
    const allBlocks: Record<string, RawBlockCatalogEntry> = {};
    const allAssemblyFiles: Record<string, string> = {};

    // 1. Load types
    if (manifest.types) {
      for (const typesUrl of manifest.types) {
        const content = await loadAsset(typesUrl, effectiveBaseUrl);
        const parsed = JSON.parse(content) as Record<string, TypeCatalogEntry>;
        for (const [k, v] of Object.entries(parsed)) {
          if (k === "$schema") continue;
          allTypes[k] = v;
        }
      }
    }

    // 2. Load namespaces
    if (manifest.namespaces) {
      for (const nsUrl of manifest.namespaces) {
        const content = await loadAsset(nsUrl, effectiveBaseUrl);
        const parsed = JSON.parse(content) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) {
          if (k === "$schema") continue;
          allNamespaces[k] = v;
        }
      }
    }

    // 3. Load blocks
    if (manifest.blocks) {
      for (const blocksUrl of manifest.blocks) {
        const content = await loadAsset(blocksUrl, effectiveBaseUrl);
        const parsed = JSON.parse(content) as Record<string, RawBlockCatalogEntry>;
        for (const [k, v] of Object.entries(parsed)) {
          if (k === "$schema") continue;
          allBlocks[k] = v;
        }
      }
    }

    // 4. Load assembly
    if (manifest.assembly) {
      for (const assemblyUrl of manifest.assembly) {
        const content = await loadAsset(assemblyUrl, effectiveBaseUrl);
        allAssemblyFiles[assemblyUrl] = content;
        const slash = assemblyUrl.lastIndexOf("/");
        const baseName = slash === -1 ? assemblyUrl : assemblyUrl.slice(slash + 1);
        allAssemblyFiles[baseName] = content;
      }
    }

    // Try loading supporting runtime assembly assets if available
    for (const helper of ["assembly/context.ts", "assembly/index.ts"]) {
      try {
        const helperContent = await loadAsset(helper);
        allAssemblyFiles[helper] = helperContent;
        const baseName = helper.slice(helper.lastIndexOf("/") + 1);
        allAssemblyFiles[baseName] = helperContent;
      } catch {
        // Optional helper
      }
    }

    return Library.fromManifest(manifest, {
      types: allTypes,
      namespaces: allNamespaces,
      blocks: allBlocks,
      assemblyFiles: allAssemblyFiles,
    });
  }

  static async loadBase(baseUrl?: string): Promise<Library> {
    if (Library.base) return Library.base;
    return Library.load("base.json", baseUrl);
  }

  static getBaseSync(): Library | undefined {
    return Library.base;
  }
}
