/**
 * @title Block Definition
 */
import type { DataType, TypeDescriptor, TypeSystem } from "../types";

export abstract class PropertyDefinition {
  constructor(
    readonly id: string,
    readonly type: DataType,
  ) {}
}

export class PortDefinition extends PropertyDefinition {
  constructor(
    id: string,
    readonly direction: "input" | "output",
    type: DataType,
    readonly vector: boolean = false,
    readonly concept?: unknown,
  ) {
    super(id, type);
  }

  get isInput(): boolean {
    return this.direction === "input";
  }

  get isOutput(): boolean {
    return this.direction === "output";
  }
}

export class InputPortDefinition extends PortDefinition {
  constructor(id: string, type: DataType, vector = false, concept?: unknown) {
    super(id, "input", type, vector, concept);
  }
}

export class OutputPortDefinition extends PortDefinition {
  constructor(id: string, type: DataType, vector = false, concept?: unknown) {
    super(id, "output", type, vector, concept);
  }
}

export class ConfigPropertyDefinition extends PropertyDefinition {
  constructor(
    id: string,
    type: DataType,
    readonly defaultValue: unknown,
    readonly control: Record<string, unknown> = {},
  ) {
    super(id, type);
  }
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

  getPort(id: string, direction: "input" | "output"): PortDefinition | undefined {
    return (direction === "input" ? this.inputs : this.outputs).get(id);
  }

  getConfig(id: string): ConfigPropertyDefinition | undefined {
    return this.config.get(id);
  }

  getDefaultConfig(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, p] of this.config) {
      if (p.defaultValue !== undefined) result[k] = p.defaultValue;
    }
    return result;
  }

  static fromRaw(id: string, raw: RawBlockCatalogEntry, typeSystem: TypeSystem): BlockDefinition {
    const ns = raw.ns ?? [];
    const category = ns.length >= 3 ? ns[2] : ns[ns.length - 1] ?? "";

    const buildPorts = (entries: Record<string, RawPortCatalogEntry> | undefined, Cls: typeof InputPortDefinition | typeof OutputPortDefinition) =>
      new Map(Object.entries(entries ?? {}).map(([portId, e]) => [portId, new Cls(portId, typeSystem.parse(e.type), Boolean(e.vector), e.concept)]));

    const config = new Map(
      Object.entries(raw.conf ?? {}).map(([confId, entry]) => {
        const ctrl = entry.control ?? {};
        const defaultValue = ctrl.default !== undefined ? ctrl.default : ctrl.type === "set_of_pins" ? [0] : undefined;
        return [confId, new ConfigPropertyDefinition(confId, typeSystem.parse(entry.type), defaultValue, ctrl)];
      }),
    );

    return new BlockDefinition(
      id,
      raw.title ?? id,
      raw.description ?? "",
      raw.icon ?? "",
      ns,
      category,
      buildPorts(raw.inputs, InputPortDefinition),
      buildPorts(raw.outputs, OutputPortDefinition),
      config,
    );
  }
}
