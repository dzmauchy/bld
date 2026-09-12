/**
 * @title Block Definition
 */
import type { DataType, TypeDescriptor, TypeSystem } from "../types";

export class PortDefinition {
  constructor(
    readonly id: string,
    readonly direction: "input" | "output",
    readonly type: DataType,
    readonly vector: boolean = false,
    readonly concept?: unknown,
  ) {}
}

export class ConfigPropertyDefinition {
  constructor(
    readonly id: string,
    readonly type: DataType,
    readonly defaultValue: unknown,
    readonly control: Record<string, unknown> = {},
  ) {}
}

export interface RawPortCatalogEntry {
  vector?: boolean;
  type: TypeDescriptor | string;
  concept?: unknown;
}

export interface RawConfigPropertyCatalogEntry {
  type: TypeDescriptor | string;
  control?: Record<string, unknown> & { default?: unknown };
}

export interface RawBlockCatalogEntry {
  ns?: readonly string[] | string[];
  icon?: string;
  title?: string;
  description?: string;
  inputs?: Record<string, RawPortCatalogEntry>;
  outputs?: Record<string, RawPortCatalogEntry>;
  conf?: Record<string, RawConfigPropertyCatalogEntry>;
}

export class BlockDefinition {
  constructor(
    readonly id: string,
    readonly title: string,
    readonly description: string,
    readonly icon: string,
    readonly namespace: readonly string[],
    readonly category: string,
    readonly inputs: ReadonlyMap<string, PortDefinition>,
    readonly outputs: ReadonlyMap<string, PortDefinition>,
    readonly config: ReadonlyMap<string, ConfigPropertyDefinition>,
  ) {}

  getInput(id: string): PortDefinition | undefined {
    return this.inputs.get(id);
  }

  getOutput(id: string): PortDefinition | undefined {
    return this.outputs.get(id);
  }

  getConfig(id: string): ConfigPropertyDefinition | undefined {
    return this.config.get(id);
  }

  getDefaultConfig(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, prop] of this.config) {
      if (prop.defaultValue !== undefined) {
        result[key] = prop.defaultValue;
      }
    }
    return result;
  }

  static fromRaw(id: string, raw: RawBlockCatalogEntry, typeSystem: TypeSystem): BlockDefinition {
    const ns = raw.ns ?? [];
    const category = ns.length >= 3 ? ns[2] : ns[ns.length - 1] ?? "";

    const inputs = new Map<string, PortDefinition>();
    if (raw.inputs) {
      for (const [portId, entry] of Object.entries(raw.inputs)) {
        inputs.set(
          portId,
          new PortDefinition(
            portId,
            "input",
            typeSystem.parse(entry.type),
            Boolean(entry.vector),
            entry.concept,
          ),
        );
      }
    }

    const outputs = new Map<string, PortDefinition>();
    if (raw.outputs) {
      for (const [portId, entry] of Object.entries(raw.outputs)) {
        outputs.set(
          portId,
          new PortDefinition(
            portId,
            "output",
            typeSystem.parse(entry.type),
            Boolean(entry.vector),
            entry.concept,
          ),
        );
      }
    }

    const config = new Map<string, ConfigPropertyDefinition>();
    if (raw.conf) {
      for (const [confId, entry] of Object.entries(raw.conf)) {
        const control = entry.control ?? {};
        let defaultValue = control.default;
        if (defaultValue === undefined) {
          // Check if set_of_pins or array
          if (control.type === "set_of_pins") {
            defaultValue = [0];
          }
        }
        config.set(
          confId,
          new ConfigPropertyDefinition(
            confId,
            typeSystem.parse(entry.type),
            defaultValue,
            control,
          ),
        );
      }
    }

    return new BlockDefinition(
      id,
      raw.title ?? id,
      raw.description ?? "",
      raw.icon ?? "",
      ns,
      category,
      inputs,
      outputs,
      config,
    );
  }
}
