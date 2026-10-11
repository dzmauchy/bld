import type { ConfigPropertyDefinition, DiagramBlock } from "core";

/** Numeric limits copied from a block parameter's control metadata. */
export class NumericBounds {
  constructor(
    readonly min: number | undefined,
    readonly max: number | undefined,
    readonly step: number | undefined,
  ) {}

  static from(control: Record<string, unknown>): NumericBounds {
    return new NumericBounds(NumericBounds.number(control.min), NumericBounds.number(control.max), NumericBounds.number(control.step));
  }

  private static number(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
}

/** Parses and displays one kind of configuration control. */
export abstract class ConfigControl {
  abstract readonly kind: "number" | "slider" | "text";

  abstract format(value: unknown): string;

  abstract parse(text: string): unknown | undefined;

  static from(property: ConfigPropertyDefinition): ConfigControl {
    const type = property.control.type;
    if (type === "text" || Array.isArray(property.defaultValue)) return new TextListConfigControl();
    const bounds = NumericBounds.from(property.control);
    if (type === "slider") return new SliderConfigControl(bounds);
    return new NumberConfigControl("number", bounds);
  }
}

/** A single finite number, or the same value chosen on a slider. */
export class NumberConfigControl extends ConfigControl {
  constructor(
    readonly kind: "number" | "slider",
    readonly bounds: NumericBounds,
  ) {
    super();
  }

  override format(value: unknown): string {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  }

  override parse(text: string): unknown | undefined {
    const value = Number(text);
    if (!Number.isFinite(value)) return undefined;
    if (this.bounds.min !== undefined && value < this.bounds.min) return undefined;
    if (this.bounds.max !== undefined && value > this.bounds.max) return undefined;
    return value;
  }
}

/** A number chosen on a bounded slider. */
export class SliderConfigControl extends NumberConfigControl {
  constructor(bounds: NumericBounds) {
    super("slider", bounds);
  }
}

/** A comma-separated list of finite numbers, such as GPIO pins. */
export class TextListConfigControl extends ConfigControl {
  readonly kind = "text" as const;

  override format(value: unknown): string {
    return Array.isArray(value) ? value.map((item) => String(item)).join(", ") : "";
  }

  override parse(text: string): unknown | undefined {
    const parts = text.split(",").map((part) => part.trim()).filter((part) => part.length > 0);
    const values = parts.map((part) => Number(part));
    if (values.some((value) => !Number.isFinite(value))) return undefined;
    return values;
  }
}

/** One editable parameter on a placed block. */
export class BlockConfigField {
  readonly control: ConfigControl;

  constructor(
    private readonly block: DiagramBlock,
    readonly property: ConfigPropertyDefinition,
  ) {
    this.control = ConfigControl.from(property);
  }

  get id(): string {
    return this.property.id;
  }

  get label(): string {
    return this.property.title;
  }

  get description(): string {
    return this.property.description;
  }

  get text(): string {
    return this.control.format(this.block.getConf(this.id));
  }

  /** Stores a parsed value. Default values stay omitted from the diagram JSON. */
  commit(text: string): boolean {
    const value = this.control.parse(text);
    if (value === undefined) return false;
    this.block.setConf(this.id, value);
    return true;
  }
}

/** The configuration dialog for one block. Blocks without parameters have none. */
export class BlockConfiguration {
  readonly fields: readonly BlockConfigField[];

  private constructor(
    readonly block: DiagramBlock,
    fields: readonly BlockConfigField[],
  ) {
    this.fields = fields;
  }

  static of(block: DiagramBlock | undefined): BlockConfiguration | undefined {
    if (!block || block.definition.config.size === 0) return undefined;
    return new BlockConfiguration(
      block,
      [...block.definition.config.values()].map((property) => new BlockConfigField(block, property)),
    );
  }
}
