/**
 * @title C++ Block Catalog
 *
 * C++ view of blocks described by header comments.
 * Apply and constructor types come from a clang++ AST dump of the native library.
 */
import { ClangTypeCatalog, type ClangApplyShape } from "cpp";
import { TypeSystem } from "../types";
import type { BlockDefinition, PortDefinition } from "./blockDefinition";
import { Palette } from "./palette";

export class BlockPortTopology {
  constructor(
    readonly definition: BlockDefinition,
    readonly shape: ClangApplyShape,
    readonly conf: Record<string, unknown> = definition.getDefaultConfig(),
  ) {}

  pinBoundInput(): PortDefinition | undefined {
    return this.definition.inputs.values().find((port) => port.lengthBindConfId !== undefined);
  }

  pinBindConfId(): string | undefined {
    return this.pinBoundInput()?.lengthBindConfId;
  }

  streamCppType(): string {
    return this.shape.streamCppType();
  }

  exposesConsumerBank(): boolean {
    return this.shape.exposesConsumerBank;
  }

  returnsScalarConsumer(): boolean {
    return this.shape.returnsScalarConsumer;
  }

  returnsIndexedConsumers(): boolean {
    return this.shape.returnsIndexedConsumers;
  }

  appliesDownstream(): boolean {
    return this.shape.appliesDownstream;
  }

  registersHostPins(): boolean {
    return this.shape.registersHostPins;
  }

  constructorParameters(): { qualType: string }[] {
    return (this.shape.ctor?.parameters ?? []).map((param) => ({ qualType: param.qualType }));
  }
}

export class CppBlockCatalog {
  static readonly shared = new CppBlockCatalog(new Palette(new TypeSystem()));
  private clangTypes: ClangTypeCatalog | undefined;

  constructor(private _palette: Palette) {}

  get palette(): Palette {
    return this._palette;
  }

  get typeSystem() {
    return this._palette.typeSystem;
  }

  get clangTypeCatalog(): ClangTypeCatalog {
    return (this.clangTypes ??= new ClangTypeCatalog());
  }

  bind(palette: Palette): void {
    this._palette = palette;
  }

  bindClangTypes(catalog: ClangTypeCatalog): void {
    this.clangTypes = catalog;
  }

  static fromPalette(palette: Palette): CppBlockCatalog {
    return new CppBlockCatalog(palette);
  }

  static bindPalette(palette: Palette): void {
    CppBlockCatalog.shared.bind(palette);
  }

  get(ref: string): BlockDefinition | undefined {
    const def = this._palette.getBlock(ref);
    return def?.cppClass ? def : undefined;
  }

  require(ref: string): BlockDefinition {
    const def = this.get(ref);
    if (!def) throw new Error(`Unknown C++ block "${ref}"`);
    return def;
  }

  topology(ref: string, conf?: Record<string, unknown>): BlockPortTopology {
    const def = this.require(ref);
    return new BlockPortTopology(def, this.clangTypeCatalog.shapeFor(def.cppClass), conf ?? def.getDefaultConfig());
  }

  refs(): string[] {
    return this._palette.getBlocks().filter((block) => Boolean(block.cppClass)).map((block) => block.id);
  }

  has(ref: string): boolean {
    return this.get(ref) !== undefined;
  }
}

export const defaultCppBlockCatalog = CppBlockCatalog.shared;
