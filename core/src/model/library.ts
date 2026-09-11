/**
 * @title Library
 */
import { TypeSystem, type TypeCatalogEntry } from "../types";
import { loadAsset, resolveUrl } from "./appAssets";
import type { RawBlockCatalogEntry } from "./blockDefinition";
import { CompilationModel } from "./compiler";
import { CppBlockCatalog } from "./cppBlockCatalog";
import { HeaderCatalog } from "./headerCatalog";
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
  headers: string[];
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

    const files = new Map<string, string>();
    const mains: string[] = [];
    const compilationModel = new CompilationModel();
    for (const headerUrl of manifest.headers ?? []) {
      const url = baseUrl ? resolveUrl(headerUrl, baseUrl) : headerUrl;
      const source = await loadAsset(url);
      const name = headerFileName(url);
      files.set(name, source);
      mains.push(name);
      compilationModel.addFile(name, source);
    }
    const catalog = await HeaderCatalog.parse(files, mains);
    return Library.fromManifest(manifest, {
      types: catalog.types,
      namespaces: catalog.namespaces,
      blocks: catalog.blocks,
      compilationModel,
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

function headerFileName(url: string): string {
  const path = url.split("?")[0] ?? url;
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash === -1 ? path : path.slice(slash + 1);
}
