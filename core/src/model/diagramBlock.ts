/**
 * @title Diagram Block
 */
import type { BlockDefinition, PortDefinition } from "./blockDefinition";

export interface RawBlockJson {
  ref: string;
  x: number;
  y: number;
  conf?: Record<string, unknown>;
}

const isEqual = (a: unknown, b: unknown): boolean =>
  a === b || (typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));

export abstract class DiagramElement {
  constructor(readonly id: string) {}
  abstract toJSON(): unknown;
}

export class DiagramBlock extends DiagramElement {
  private readonly confValues = new Map<string, unknown>();

  constructor(
    id: string,
    readonly definition: BlockDefinition,
    public x: number,
    public y: number,
    initialConf: Record<string, unknown> = {},
  ) {
    super(id);
    Object.entries(initialConf).forEach(([k, v]) => this.confValues.set(k, v));
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
    return Object.assign(this.definition.getDefaultConfig(), Object.fromEntries(this.confValues));
  }

  isDefault(key: string): boolean {
    return isEqual(this.getConf(key), this.definition.getConfig(key)?.defaultValue);
  }

  getNonDefaultConfig(): Record<string, unknown> {
    const nonDefault: Record<string, unknown> = {};
    for (const [key] of this.definition.config) {
      if (!this.isDefault(key)) nonDefault[key] = this.getConf(key);
    }
    for (const [key, value] of this.confValues) {
      if (!this.definition.config.has(key)) nonDefault[key] = value;
    }
    return nonDefault;
  }

  getInputPorts(): PortDefinition[] {
    return [...this.definition.inputs.values()];
  }

  getOutputPorts(): PortDefinition[] {
    return [...this.definition.outputs.values()];
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
