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

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined && b === undefined) return true;
  if (a === null && b === null) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export class DiagramBlock {
  private confValues = new Map<string, unknown>();

  constructor(
    readonly id: string,
    readonly definition: BlockDefinition,
    public x: number,
    public y: number,
    initialConf: Record<string, unknown> = {},
  ) {
    for (const [key, val] of Object.entries(initialConf)) {
      this.confValues.set(key, val);
    }
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
    if (this.confValues.has(key)) {
      return this.confValues.get(key) as T;
    }
    const prop = this.definition.getConfig(key);
    return prop?.defaultValue as T | undefined;
  }

  getAllConf(): Record<string, unknown> {
    const result = this.definition.getDefaultConfig();
    for (const [k, v] of this.confValues) {
      result[k] = v;
    }
    return result;
  }

  isDefault(key: string): boolean {
    const current = this.getConf(key);
    const def = this.definition.getConfig(key)?.defaultValue;
    return deepEqual(current, def);
  }

  getNonDefaultConfig(): Record<string, unknown> {
    const nonDefault: Record<string, unknown> = {};
    for (const [key] of this.definition.config) {
      if (!this.isDefault(key)) {
        nonDefault[key] = this.getConf(key);
      }
    }
    // Also include any extra custom properties not in definition
    for (const [key, value] of this.confValues) {
      if (!this.definition.config.has(key)) {
        nonDefault[key] = value;
      }
    }
    return nonDefault;
  }

  getInputPorts(): PortDefinition[] {
    return [...this.definition.inputs.values()];
  }

  getOutputPorts(): PortDefinition[] {
    return [...this.definition.outputs.values()];
  }

  toJSON(): RawBlockJson {
    const json: RawBlockJson = {
      ref: this.definition.id,
      x: this.x,
      y: this.y,
    };
    const nonDefault = this.getNonDefaultConfig();
    if (Object.keys(nonDefault).length > 0) {
      json.conf = nonDefault;
    }
    return json;
  }
}
