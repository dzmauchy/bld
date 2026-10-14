import type { BlockDefinition, DiagramBlock } from "core";

/** Configuration of the browser-driven GPIO source pins, in runtime channel order. */
export class GpioInputBlock {
  private constructor(readonly pins: readonly number[]) {}

  static matches(definition: BlockDefinition): boolean {
    return definition.id.startsWith("GpioIn");
  }

  static of(block: DiagramBlock): GpioInputBlock | undefined {
    if (!this.matches(block.definition)) return undefined;
    const pins = block.getConf("pins");
    return new GpioInputBlock(Array.isArray(pins) ? pins : []);
  }

  static defaultPinCount(definition: BlockDefinition): number {
    const pins = definition.getConfig("pins")?.defaultValue;
    return this.matches(definition) && Array.isArray(pins) ? pins.length : 0;
  }
}
