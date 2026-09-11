export interface Identifiable {
  readonly id: string;
}

export interface Displayable extends Identifiable {
  readonly name: string;
  readonly icon: string;
  readonly description: string;
}

export class Namespace implements Displayable {

  readonly #children: Namespace[] = Array<Namespace>(0);

  constructor(
    readonly id: string,
    readonly name: string,
    readonly icon: string,
    readonly description: string,
    readonly parent?: Namespace
  ) {
    if (parent) {
      parent.#children.push(this);
    }
  }

  get children(): readonly Namespace[] {
    return this.#children;
  }
}

export class PaletteBlock implements Displayable {

  constructor(
    readonly namespace: Namespace,
    readonly id: string,
    readonly name: string,
    readonly icon: string,
    readonly description: string,
  ) {
  }
}