import type { BlockDefinition } from "core";

/** The palette block armed for click-to-insert. Clicking it again clears the arm. */
export class PaletteArm {
  private current: BlockDefinition | undefined;

  toggle(definition: BlockDefinition): BlockDefinition | undefined {
    this.current = this.current?.id === definition.id ? undefined : definition;
    return this.current;
  }

  get definition(): BlockDefinition | undefined {
    return this.current;
  }

  isArmed(id: string): boolean {
    return this.current?.id === id;
  }
}
