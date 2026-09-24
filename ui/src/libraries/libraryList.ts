import { CompilationModel, Library, LibraryArchive, type BlockDefinition, type PackageManifest } from "core";
import baseManifest from "core/assets/base.json?raw";
import { HeaderCommentCatalog } from "./headerCommentCatalog.js";

/** Libraries loaded into the IDE. The default list is the base library. */
export class LibraryList {
  static readonly defaultIds = ["base"] as const;

  constructor(readonly ids: readonly string[] = LibraryList.defaultIds) {}

  async load(): Promise<Library[]> {
    const libraries: Library[] = [];
    for (const id of this.ids) libraries.push(await this.loadOne(id));
    return libraries;
  }

  /** Every block from each library, in library-list order. */
  async blocks(): Promise<BlockDefinition[]> {
    const blocks: BlockDefinition[] = [];
    for (const library of await this.load()) blocks.push(...library.palette.getBlocks());
    return blocks;
  }

  private async loadOne(id: string): Promise<Library> {
    const manifest = manifestFor(id);
    const archive = await LibraryArchive.fetch(manifest.location);
    const catalog = HeaderCommentCatalog.fromSources(archive.sources());
    return Library.fromManifest(manifest, {
      types: catalog.types,
      blocks: catalog.blocks,
      namespaces: catalog.namespaces,
      compilationModel: new CompilationModel(archive.files()),
    });
  }
}

function manifestFor(id: string): PackageManifest {
  if (id === "base") return JSON.parse(baseManifest) as PackageManifest;
  throw new Error(`Library "${id}" is not available`);
}
