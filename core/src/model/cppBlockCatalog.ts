import { TypeSystem } from "../types";
import type { BlockDefinition } from "./blockDefinition";
import { Palette } from "./palette";

export class CppBlockCatalog {
  static readonly shared = new CppBlockCatalog(new Palette(new TypeSystem()));

  constructor(private _palette: Palette) {}

  get palette(): Palette {
    return this._palette;
  }

  get typeSystem() {
    return this._palette.typeSystem;
  }

  bind(palette: Palette): void {
    this._palette = palette;
  }

  static fromPalette(palette: Palette): CppBlockCatalog {
    return new CppBlockCatalog(palette);
  }

  static bindPalette(palette: Palette): void {
    CppBlockCatalog.shared.bind(palette);
  }

  get(ref: string): BlockDefinition | undefined {
    const def = this._palette.getBlock(ref);
    return def?.cppFactory ? def : undefined;
  }

  require(ref: string): BlockDefinition {
    const def = this.get(ref);
    if (!def) throw new Error(`Unknown C++ block "${ref}"`);
    return def;
  }

  refs(): string[] {
    return this._palette.getBlocks().filter((block) => Boolean(block.cppFactory)).map((block) => block.id);
  }

  has(ref: string): boolean {
    return this.get(ref) !== undefined;
  }
}

export const defaultCppBlockCatalog = CppBlockCatalog.shared;
