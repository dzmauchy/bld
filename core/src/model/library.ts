/**
 * @title Library
 */
import { TypeSystem, type TypeCatalogEntry } from "../types";
import { loadAsset, resolveUrl } from "./appAssets";
import { BlockDefinition, type RawBlockCatalogEntry } from "./blockDefinition";
import { CompilationModel } from "./compiler";
import { Palette } from "./palette";
import { defaultRegistry, installAssemblySource } from "runtime";

export {
  AppAssetStore,
  clearRegisteredAppAssets,
  fetchText,
  getRegisteredAppAsset,
  loadAsset,
  normalizeAssetPath,
  registerAppAsset,
  registerAppAssets,
  setAppAssetResolver,
  type AssetResolver,
} from "./appAssets";

export interface PackageManifest {
  $schema?: string;
  id: string;
  name: string;
  icon?: string;
  types?: string[];
  namespaces?: string[];
  blocks?: string[];
  assembly?: string;
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

  static async load(manifestOrUrl: string | PackageManifest): Promise<Library> {
    let manifest: PackageManifest;
    const baseUrl =
      typeof manifestOrUrl === "string" && URL.canParse(manifestOrUrl)
        ? manifestOrUrl
        : undefined;

    if (typeof manifestOrUrl === "string") {
      const manifestText = await loadAsset(manifestOrUrl);
      manifest = JSON.parse(manifestText) as PackageManifest;
    } else {
      manifest = manifestOrUrl;
    }

    const allTypes: Record<string, TypeCatalogEntry> = {};
    const allNamespaces: Record<string, unknown> = {};
    const allBlocks: Record<string, RawBlockCatalogEntry> = {};
    const allAssemblyFiles: Record<string, string> = {};

    if (manifest.types) {
      for (const typesUrl of manifest.types) {
        const url = baseUrl ? resolveUrl(typesUrl, baseUrl) : typesUrl;
        const content = await loadAsset(url);
        const parsed = JSON.parse(content) as Record<string, TypeCatalogEntry>;
        for (const [key, value] of Object.entries(parsed)) {
          if (key === "$schema") continue;
          allTypes[key] = value;
        }
      }
    }

    if (manifest.namespaces) {
      for (const nsUrl of manifest.namespaces) {
        const url = baseUrl ? resolveUrl(nsUrl, baseUrl) : nsUrl;
        const content = await loadAsset(url);
        const parsed = JSON.parse(content) as Record<string, unknown>;
        for (const [key, value] of Object.entries(parsed)) {
          if (key === "$schema") continue;
          allNamespaces[key] = value;
        }
      }
    }

    if (manifest.blocks) {
      for (const blocksUrl of manifest.blocks) {
        const url = baseUrl ? resolveUrl(blocksUrl, baseUrl) : blocksUrl;
        const content = await loadAsset(url);
        const parsed = JSON.parse(content) as Record<string, RawBlockCatalogEntry>;
        for (const [key, value] of Object.entries(parsed)) {
          if (key === "$schema") continue;
          allBlocks[key] = value;
        }
      }
    }

    if (manifest.assembly) {
      const url = baseUrl ? resolveUrl(manifest.assembly, baseUrl) : manifest.assembly;
      const content = await loadAsset(url);
      allAssemblyFiles[manifest.assembly] = content;
      const slash = manifest.assembly.lastIndexOf("/");
      const baseName = slash === -1 ? manifest.assembly : manifest.assembly.slice(slash + 1);
      allAssemblyFiles[baseName] = content;
      await installAssemblySource(content, defaultRegistry);
    }

    return Library.fromManifest(manifest, {
      types: allTypes,
      namespaces: allNamespaces,
      blocks: allBlocks,
      assemblyFiles: allAssemblyFiles,
    });
  }

  static async loadBase(): Promise<Library> {
    if (Library.base) return Library.base;
    return Library.load("base.json");
  }

  static getBaseSync(): Library | undefined {
    return Library.base;
  }
}
