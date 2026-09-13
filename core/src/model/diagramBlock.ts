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

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

export abstract class DiagramElement {
  constructor(readonly id: string) {}
  abstract toJSON(): unknown;
}

export class DiagramBlock extends DiagramElement {
  private readonly confValues: Map<string, unknown>;

  constructor(
    id: string,
    readonly definition: BlockDefinition,
    private _x: number,
    private _y: number,
    initialConf: Record<string, unknown> = {},
  ) {
    super(id);
    this.confValues = new Map(Object.entries(initialConf));
  }

  get x(): number {
    return this._x;
  }

  get y(): number {
    return this._y;
  }

  get ref(): string {
    return this.definition.id;
  }

  setPosition(x: number, y: number): void {
    this._x = x;
    this._y = y;
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
    return this.definition.inputs.values().toArray();
  }

  getOutputPorts(): PortDefinition[] {
    return this.definition.outputs.values().toArray();
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
