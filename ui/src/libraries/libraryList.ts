import { Library, type BlockDefinition } from "core";
import { BundledLibraryRegistry } from "./bundledLibraries.js";
import { HeaderCommentCatalog } from "./headerCommentCatalog.js";

/** Libraries loaded into the IDE. The default list is the base library. */
export class LibraryList {
  static readonly defaultIds = ["base"] as const;

  constructor(readonly ids: readonly string[] = LibraryList.defaultIds) {}

  load(): Library[] {
    return this.ids.map((id) => this.loadOne(id));
  }

  /** Every block from each library, in library-list order. */
  blocks(): BlockDefinition[] {
    const blocks: BlockDefinition[] = [];
    for (const library of this.load()) blocks.push(...library.palette.getBlocks());
    return blocks;
  }

  private loadOne(id: string): Library {
    const bundled = BundledLibraryRegistry.shared.require(id);
    const catalog = HeaderCommentCatalog.fromSources(bundled.headerSources());
    return Library.fromManifest(bundled.manifest(), {
      types: catalog.types,
      blocks: catalog.blocks,
      namespaces: catalog.namespaces,
    });
  }
}
