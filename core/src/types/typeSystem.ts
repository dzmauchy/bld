import {
  DataType,
  ParameterizedType,
  PrimitiveType,
  TypeVariable,
  type TypeDescriptor,
} from "./types";

export interface TypeCatalogEntry {
  name: string;
  description?: string;
  as_arg_compatible_with?: readonly string[];
  params?: Record<string, { name: string; description?: string }>;
}

export class TypeSystem {
  private primitives = new Map<string, PrimitiveType>();
  private parameterizedTemplates = new Map<
    string,
    { name: string; description: string; params: readonly string[] }
  >();

  registerPrimitive(
    raw: string,
    name: string,
    description = "",
    compatibleWith: readonly string[] = [],
  ): PrimitiveType {
    const type = new PrimitiveType(raw, name, description, new Set(compatibleWith));
    this.primitives.set(raw, type);
    return type;
  }

  registerParameterized(
    raw: string,
    name: string,
    description = "",
    params: readonly string[] = [],
  ): void {
    this.parameterizedTemplates.set(raw, { name, description, params });
  }

  getPrimitive(raw: string): PrimitiveType | undefined {
    return this.primitives.get(raw);
  }

  getParameterizedTemplate(
    raw: string,
  ): { name: string; description: string; params: readonly string[] } | undefined {
    return this.parameterizedTemplates.get(raw);
  }

  parse(desc: TypeDescriptor | string): DataType {
    const raw = typeof desc === "string" ? desc : desc.raw;
    const args = typeof desc === "string" ? undefined : desc.args;
    if (!args || Object.keys(args).length === 0) {
      return this.primitives.get(raw) ?? (raw.startsWith("?") ? new TypeVariable(raw.slice(1)) : new PrimitiveType(raw, raw));
    }
    const template = this.parameterizedTemplates.get(raw);
    const parsedArgs = new Map(Object.entries(args).map(([k, v]) => [k, this.parse(v)]));
    return new ParameterizedType(raw, template?.name ?? raw, template?.description ?? "", parsedArgs);
  }

  isCompatible(source: DataType, target: DataType): boolean {
    if (source instanceof TypeVariable && source.isBound()) return this.isCompatible(source.resolved!, target);
    if (target instanceof TypeVariable && target.isBound()) return this.isCompatible(source, target.resolved!);
    if (source.equals(target)) return true;
    if (source instanceof PrimitiveType && target instanceof PrimitiveType) {
      return target.isArgCompatibleWith(source.raw);
    }
    if (source instanceof ParameterizedType && target instanceof ParameterizedType) {
      return (
        source.raw === target.raw &&
        source.args.size === target.args.size &&
        [...source.args].every(([k, v]) => {
          const t = target.getArg(k);
          return t !== undefined && this.isCompatible(v, t);
        })
      );
    }
    return false;
  }

  static fromCatalog(catalog: Record<string, TypeCatalogEntry>): TypeSystem {
    const ts = new TypeSystem();
    for (const [raw, entry] of Object.entries(catalog)) {
      if (raw === "$schema") continue;
      if (entry.params) {
        ts.registerParameterized(raw, entry.name, entry.description ?? "", Object.keys(entry.params));
      } else {
        ts.registerPrimitive(raw, entry.name, entry.description ?? "", entry.as_arg_compatible_with ?? []);
      }
    }
    return ts;
  }

  static fromLibrary(library: { typeSystem: TypeSystem }): TypeSystem {
    return library.typeSystem;
  }
}
