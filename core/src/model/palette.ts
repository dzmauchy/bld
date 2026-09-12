/**
 * @title Palette
 */
import { BlockDefinition, type RawBlockCatalogEntry } from "./blockDefinition";
import { TypeSystem, type TypeCatalogEntry } from "../types";
import type { Library } from "./library";

export interface IPalette {
  readonly typeSystem: TypeSystem;
  registerBlock(def: BlockDefinition): void;
  getBlock(id: string): BlockDefinition | undefined;
  hasBlock(id: string): boolean;
  getBlocks(): BlockDefinition[];
  getBlocksByCategory(category: string): BlockDefinition[];
  getBlocksByNamespace(nsPrefix: string[]): BlockDefinition[];
  search(query: string): BlockDefinition[];
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

  getBlock(id: string): BlockDefinition | undefined {
    return this.blocks.get(id);
  }

  hasBlock(id: string): boolean {
    return this.blocks.has(id);
  }

  getBlocks(): BlockDefinition[] {
    return [...this.blocks.values()];
  }

  getBlocksByCategory(category: string): BlockDefinition[] {
    return this.getBlocks().filter((b) => b.category.toLowerCase() === category.toLowerCase());
  }

  getBlocksByNamespace(nsPrefix: string[]): BlockDefinition[] {
    return this.getBlocks().filter((b) => {
      if (b.namespace.length < nsPrefix.length) return false;
      return nsPrefix.every((part, i) => b.namespace[i] === part);
    });
  }

  search(query: string): BlockDefinition[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.getBlocks();
    return this.getBlocks().filter(
      (b) =>
        b.id.toLowerCase().includes(q) ||
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
