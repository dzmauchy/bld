/**
 * @title Palette
 */
import { BlockDefinition, type RawBlockCatalogEntry } from "./blockDefinition";
import { TypeSystem, type TypeCatalogEntry } from "../types";
import type { Library } from "./library";

export interface IPalette {
  readonly typeSystem: TypeSystem;
  registerBlock(def: BlockDefinition): void;
  getBlocks(): IteratorObject<BlockDefinition>;
  getBlocksByCategory(category: string): IteratorObject<BlockDefinition>;
  getBlocksByNamespace(nsPrefix: string[]): IteratorObject<BlockDefinition>;
  search(query: string): IteratorObject<BlockDefinition, undefined>;
}

export class Palette implements IPalette {
  private readonly blocks = new Map<string, BlockDefinition>();

  constructor(
    readonly typeSystem: TypeSystem,
    readonly namespaces: Record<string, unknown> = {},
  ) {}

  registerBlock(def: BlockDefinition): void {
    this.blocks.set(def.id, def);
  }

  getBlocks(): IteratorObject<BlockDefinition> {
    return this.blocks.values();
  }

  getBlocksByCategory(category: string): IteratorObject<BlockDefinition> {
    const normalized = category.toLowerCase();
    return this.getBlocks().filter((b) => b.category.toLowerCase() === normalized);
  }

  getBlocksByNamespace(nsPrefix: string[]): IteratorObject<BlockDefinition> {
    return this.getBlocks().filter((b) => nsPrefix.every((part, i) => b.namespace[i] === part));
  }

  *search(query: string): IteratorObject<BlockDefinition, undefined> {
    const trimmed = query.trim();
    const exact = this.blocks.get(trimmed);
    if (exact) {
      yield exact;
      return;
    }

    const q = trimmed.toLowerCase();
    if (!q) {
      yield* this.getBlocks();
      return;
    }
    yield* this.getBlocks().filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q),
    );
  }

  static fromCatalog(
    blocksCatalog: Record<string, RawBlockCatalogEntry>,
    typesCatalog: Record<string, TypeCatalogEntry>,
    namespacesCatalog: Record<string, unknown> = {},
  ): Palette {
    const typeSystem = TypeSystem.fromCatalog(typesCatalog);
    const palette = new Palette(typeSystem, namespacesCatalog);

    for (const [id, raw] of Object.entries(blocksCatalog)) {
      if (id === "$schema") continue;
      palette.registerBlock(BlockDefinition.fromRaw(id, raw, typeSystem));
    }

    return palette;
  }

  static fromLibrary(library: Library): Palette {
    return library.palette;
  }
}
