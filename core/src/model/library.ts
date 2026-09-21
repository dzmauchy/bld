/**
 * @title Library
 */
import { TypeSystem, type TypeCatalogEntry } from "../types";
import { loadAsset, resolveUrl } from "./appAssets";
import type { RawBlockCatalogEntry } from "./blockDefinition";
import { CompilationModel } from "./compiler";
import { CppBlockCatalog } from "./cppBlockCatalog";
import { Palette } from "./palette";

export {
  AbstractAssetStore,
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
  type IAssetResolver,
} from "./appAssets";

export interface PackageManifest {
  $schema?: string;
  id: string;
  name: string;
  icon?: string;
  types?: string[];
  namespaces?: string[];
  blocks?: string[];
}

export interface LibrarySources {
  types?: Record<string, TypeCatalogEntry>;
  namespaces?: Record<string, unknown>;
  blocks?: Record<string, RawBlockCatalogEntry>;
  compilationModel?: CompilationModel | undefined;
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

    const palette = Palette.fromCatalog(blocks, types, namespaces);
    const compilationModel = sources.compilationModel ?? new CompilationModel();

    const lib = new Library(
      manifest,
      palette.typeSystem,
      palette,
      compilationModel,
      types,
      namespaces,
      blocks,
    );

    if (manifest.id === "base") {
      Library.base = lib;
      CppBlockCatalog.bindPalette(lib.palette);
    }
    return lib;
  }

  static async load(manifestOrUrl: string | PackageManifest): Promise<Library> {
    const baseUrl = typeof manifestOrUrl === "string" && URL.canParse(manifestOrUrl) ? manifestOrUrl : undefined;
    const manifest: PackageManifest = typeof manifestOrUrl === "string"
      ? JSON.parse(await loadAsset(manifestOrUrl))
      : manifestOrUrl;

    const loadCatalog = async <T>(urls?: string[]): Promise<Record<string, T>> => {
      const result: Record<string, T> = {};
      for (const itemUrl of urls ?? []) {
        const url = baseUrl ? resolveUrl(itemUrl, baseUrl) : itemUrl;
        const parsed = JSON.parse(await loadAsset(url)) as Record<string, T>;
        for (const [k, v] of Object.entries(parsed)) {
          if (k !== "$schema") result[k] = v;
        }
      }
      return result;
    };

    const allTypes = await loadCatalog<TypeCatalogEntry>(manifest.types);
    const allNamespaces = await loadCatalog<unknown>(manifest.namespaces);
    const allBlocks = await loadCatalog<RawBlockCatalogEntry>(manifest.blocks);

    return Library.fromManifest(manifest, {
      types: allTypes,
      namespaces: allNamespaces,
      blocks: allBlocks,
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
