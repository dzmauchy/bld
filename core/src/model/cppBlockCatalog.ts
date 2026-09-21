/**
 * @title C++ Block Catalog
 *
 * C++ view of the JSON block catalog. Types come from `types.json` via the
 * palette TypeSystem; class names and ports come from `blocks.json`.
 */
import { ParameterizedType, TypeSystem, type DataType } from "../types";
import { confLengthBindId, TypeInference, type InferredPortType } from "../types/typeInference";
import type { BlockDefinition, PortDefinition } from "./blockDefinition";
import { Palette } from "./palette";

export class CppTypeNames {
  static of(type: DataType): string {
    if (type instanceof ParameterizedType) {
      const inner = type.getArg("T");
      const arg = inner ? CppTypeNames.of(inner) : "";
      if (type.raw === "array") return `Array<${arg}>`;
      if (type.raw === "pss") return `Pss<${arg}>`;
      return arg ? `${type.raw}<${arg}>` : type.raw;
    }
    return type.raw;
  }

  static vectorizedInput(streamType: DataType): string {
    return `VectorizedInput<${CppTypeNames.of(streamType)}>`;
  }

  static elementType(type: DataType): DataType | undefined {
    return type instanceof ParameterizedType && type.raw === "array" ? type.getArg("T") : undefined;
  }

  static isArray(type: DataType): boolean {
    return type instanceof ParameterizedType && type.raw === "array";
  }

  static literal(type: DataType, value: unknown): string {
    const raw = type.raw;
    if (raw === "bool") return value ? "true" : "false";
    if (raw === "f32") return f32Lit(Number(value));
    if (raw === "f64") {
      const n = Number(value);
      return Number.isInteger(n) ? `${n}.0` : String(n);
    }
    const n = Number(value);
    if (raw === "u32" || raw === "u64") return `${Math.trunc(n)}u`;
    return String(Math.trunc(n));
  }
}

function f32Lit(value: number): string {
  if (Object.is(value, -0)) return "-0.f";
  if (Number.isInteger(value)) return `${value}.f`;
  return `${value}f`;
}

/**
 * Port topology derived from JSON inputs/outputs rather than a closed block-kind union.
 */
export class BlockPortTopology {
  constructor(
    readonly definition: BlockDefinition,
    readonly inference: TypeInference,
    readonly conf: Record<string, unknown> = definition.getDefaultConfig(),
  ) {}

  inferInput(id: string): InferredPortType | undefined {
    const port = this.definition.getInput(id);
    return port ? this.inference.inferPort(port, this.conf) : undefined;
  }

  inferOutput(id: string): InferredPortType | undefined {
    const port = this.definition.getOutput(id);
    return port ? this.inference.inferPort(port, this.conf) : undefined;
  }

  inferInputs(): Map<string, InferredPortType> {
    const result = new Map<string, InferredPortType>();
    for (const [id, port] of this.definition.inputs) {
      result.set(id, this.inference.inferPort(port, this.conf));
    }
    return result;
  }

  inferOutputs(): Map<string, InferredPortType> {
    const result = new Map<string, InferredPortType>();
    for (const [id, port] of this.definition.outputs) {
      result.set(id, this.inference.inferPort(port, this.conf));
    }
    return result;
  }

  pinBoundInput(): PortDefinition | undefined {
    return this.definition.inputs.values().find((port) => confLengthBindId(port) !== undefined);
  }

  pinBindConfId(): string | undefined {
    const port = this.pinBoundInput();
    return port ? confLengthBindId(port) : undefined;
  }

  streamType(): DataType | undefined {
    for (const inferred of [...this.inferOutputs().values(), ...this.inferInputs().values()]) {
      if (inferred.isStream) return inferred.dataType;
    }
    return undefined;
  }

  exposesConsumerBank(): boolean {
    return this.definition.outputs.size > 0 && this.definition.inputs.size === 0;
  }

  returnsScalarConsumer(): boolean {
    return this.definition.inputs.size > 0 && this.inferOutputs().values().some((port) => port.isStream && !port.isVector);
  }

  returnsIndexedConsumers(): boolean {
    return this.exposesConsumerBank() || (this.definition.outputs.size > 0 && !this.returnsScalarConsumer());
  }

  appliesDownstream(): boolean {
    return this.definition.inputs.size > 0 && this.pinBoundInput() === undefined;
  }

  registersHostPins(): boolean {
    return this.pinBoundInput() !== undefined;
  }
}

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
    return def?.cppClass ? def : undefined;
  }

  require(ref: string): BlockDefinition {
    const def = this.get(ref);
    if (!def) throw new Error(`Unknown C++ block "${ref}"`);
    return def;
  }

  topology(ref: string, conf?: Record<string, unknown>): BlockPortTopology {
    const def = this.require(ref);
    return new BlockPortTopology(def, new TypeInference(this.typeSystem), conf ?? def.getDefaultConfig());
  }

  refs(): string[] {
    return this._palette.getBlocks().filter((block) => Boolean(block.cppClass)).map((block) => block.id);
  }

  has(ref: string): boolean {
    return this.get(ref) !== undefined;
  }
}

export const defaultCppBlockCatalog = CppBlockCatalog.shared;
