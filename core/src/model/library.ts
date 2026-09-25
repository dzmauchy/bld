/**
 * @title Library
 */
import { TypeSystem, type TypeCatalogEntry } from "../types";
import { loadAsset, resolveUrl } from "./appAssets";
import type { RawBlockCatalogEntry } from "./blockDefinition";
import { ClangAstDumper, type ResolvedApply } from "cpp";
import { CompilationModel } from "./compiler";
import { CppBlockCatalog } from "./cppBlockCatalog";
import { HeaderCatalog } from "./headerCatalog";
import { LibraryArchive } from "./libraryArchive";
import { Palette } from "./palette";

export {
  AbstractAssetStore,
  AppAssetStore,
  clearRegisteredAppAssets,
  fetchText,
  getRegisteredAppAsset,
  loadAsset,
  loadAssetBytes,
  normalizeAssetPath,
  registerAppAsset,
  registerAppAssetBytes,
  registerAppAssets,
  setAppAssetResolver,
  type AssetResolver,
  type IAssetResolver,
} from "./appAssets";

export interface PackageManifest {
  $schema?: string;
  id: string;
  name: string;
  icon: string;
  location: string;
}

export interface LibrarySources {
  types?: Record<string, TypeCatalogEntry>;
  namespaces?: Record<string, unknown>;
  blocks?: Record<string, RawBlockCatalogEntry>;
  signatures?: ReadonlyMap<string, ResolvedApply>;
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

  get icon(): string {
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
      const files = compilationModel.getFiles();
      if (files["base.hpp"]) ClangAstDumper.bindLibraryFiles(files);
    }
    if (sources.signatures && sources.signatures.size > 0) {
      CppBlockCatalog.shared.clangTypeCatalog.bindResolved(sources.signatures);
    }
    return lib;
  }

  static async load(manifestOrUrl: string | PackageManifest): Promise<Library> {
    const baseUrl = typeof manifestOrUrl === "string" && URL.canParse(manifestOrUrl) ? manifestOrUrl : undefined;
    const manifest: PackageManifest = typeof manifestOrUrl === "string"
      ? JSON.parse(await loadAsset(manifestOrUrl)) as PackageManifest
      : manifestOrUrl;
    const archive = await LibraryArchive.fetch(resolveUrl(manifest.location, baseUrl));
    const files = archive.files();
    const compilationModel = new CompilationModel(files);
    const catalog = await HeaderCatalog.parse(files, Object.keys(files));
    return Library.fromManifest(manifest, {
      types: catalog.types,
      namespaces: catalog.namespaces,
      blocks: catalog.blocks,
      signatures: catalog.signatures,
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

