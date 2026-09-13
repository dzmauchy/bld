export interface TypeDescriptor {
  raw: string;
  args?: Record<string, TypeDescriptor>;
}

export abstract class DataType {
  abstract readonly raw: string;
  abstract readonly name: string;
  abstract toString(): string;
  abstract equals(other: DataType): boolean;
}

export class PrimitiveType extends DataType {
  constructor(
    readonly raw: string,
    readonly name: string,
    readonly description: string = "",
    readonly compatibleWith: ReadonlySet<string> = new Set(),
  ) {
    super();
  }

  toString(): string {
    return this.raw;
  }

  equals(other: DataType): boolean {
    return other instanceof PrimitiveType && other.raw === this.raw;
  }

  isArgCompatibleWith(sourceRaw: string): boolean {
    return this.compatibleWith.has(sourceRaw);
  }
}

export class ParameterizedType extends DataType {
  constructor(
    readonly raw: string,
    readonly name: string,
    readonly description: string = "",
    readonly args: ReadonlyMap<string, DataType> = new Map(),
  ) {
    super();
  }

  getArg(paramName: string): DataType | undefined {
    return this.args.get(paramName);
  }

  toString(): string {
    if (this.args.size === 0) return this.raw;
    const parts = this.args.entries().map(([k, v]) => `${k}=${v.toString()}`).toArray().join(", ");
    return `${this.raw}<${parts}>`;
  }

  equals(other: DataType): boolean {
    if (!(other instanceof ParameterizedType) || other.raw !== this.raw) return false;
    return (
      other.args.size === this.args.size &&
      this.args.entries().every(([k, v]) => other.args.get(k)?.equals(v) ?? false)
    );
  }
}

export class TypeVariable extends DataType {
  private boundType: DataType | undefined;

  constructor(
    readonly name: string,
    readonly description: string = "",
  ) {
    super();
  }

  get raw(): string {
    return this.boundType ? this.boundType.raw : this.name;
  }

  get resolved(): DataType | undefined {
    return this.boundType;
  }

  isBound(): boolean {
    return this.boundType !== undefined;
  }

  bind(concrete: DataType): void {
    if (this.boundType && !this.boundType.equals(concrete)) {
      throw new Error(`Type variable ${this.name} already bound to ${this.boundType.toString()}, cannot bind to ${concrete.toString()}`);
    }
    this.boundType = concrete;
  }

  unbind(): void {
    this.boundType = undefined;
  }

  toString(): string {
    return this.boundType ? this.boundType.toString() : `?${this.name}`;
  }

  equals(other: DataType): boolean {
    if (this.boundType) return this.boundType.equals(other);
    return other instanceof TypeVariable && other.name === this.name;
  }
}
