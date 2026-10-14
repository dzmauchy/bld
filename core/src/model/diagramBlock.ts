/**
 * @title Diagram Block
 */
import { PortDefinition, type BlockDefinition } from "./blockDefinition";
import type { DiagramDiagnostic } from "./cppBuilder";
import type { InferredPortType } from "./inferredPortType";

export interface RawBlockJson {
  ref: string;
  x: number;
  y: number;
  conf?: Record<string, unknown>;
}

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

export abstract class DiagramElement {
  constructor(readonly id: string) {}
  abstract toJSON(): unknown;
}

/** Analysis belongs to a block instance, rather than its shared palette definition. */
export class DiagramBlockPort extends PortDefinition {
  private resolvedType: InferredPortType | undefined;
  private messages: readonly DiagramDiagnostic[] = [];

  constructor(definition: PortDefinition) {
    super(definition.id, definition.direction, definition.type, definition.vector, definition.concept, definition.length);
  }

  get inferredType(): InferredPortType | undefined {
    return this.resolvedType;
  }

  get diagnostics(): readonly DiagramDiagnostic[] {
    return this.messages;
  }

  get hasError(): boolean {
    return this.messages.some((diagnostic) => diagnostic.severity === "error");
  }

  assignAnalysis(type: InferredPortType | undefined, diagnostics: readonly DiagramDiagnostic[]): void {
    this.resolvedType = type;
    this.messages = [...diagnostics];
  }
}

export class DiagramBlock extends DiagramElement {
  private readonly confValues: Map<string, unknown>;
  readonly inputPorts: readonly DiagramBlockPort[];
  readonly outputPorts: readonly DiagramBlockPort[];

  constructor(
    id: string,
    readonly definition: BlockDefinition,
    public x: number,
    public y: number,
    initialConf: Record<string, unknown> = {},
  ) {
    super(id);
    this.confValues = new Map(Object.entries(initialConf));
    this.inputPorts = Array.from(definition.inputs.values(), (port) => new DiagramBlockPort(port));
    this.outputPorts = Array.from(definition.outputs.values(), (port) => new DiagramBlockPort(port));
  }

  get ref(): string {
    return this.definition.id;
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  setConf(key: string, value: unknown): void {
    this.confValues.set(key, value);
  }

  getConf<T = unknown>(key: string): T | undefined {
    return (this.confValues.has(key) ? this.confValues.get(key) : this.definition.getConfig(key)?.defaultValue) as T | undefined;
  }

  getAllConf(): Record<string, unknown> {
    return { ...this.definition.getDefaultConfig(), ...Object.fromEntries(this.confValues) };
  }

  getExplicitConfig(): Record<string, unknown> {
    return Object.fromEntries(this.confValues);
  }

  isDefault(key: string): boolean {
    return isEqual(this.getConf(key), this.definition.getConfig(key)?.defaultValue);
  }

  getNonDefaultConfig(): Record<string, unknown> {
    const nonDefault: Record<string, unknown> = {};
    for (const [key, value] of this.confValues) {
      if (!this.definition.config.has(key) || !this.isDefault(key)) nonDefault[key] = value;
    }
    return nonDefault;
  }

  override toJSON(): RawBlockJson {
    const conf = this.getNonDefaultConfig();
    return {
      ref: this.definition.id,
      x: this.x,
      y: this.y,
      ...(Object.keys(conf).length ? { conf } : {}),
    };
  }
}
