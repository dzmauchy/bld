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
    if (typeof desc === "string") {
      const prim = this.primitives.get(desc);
      if (prim) return prim;
      if (desc.startsWith("?")) return new TypeVariable(desc.slice(1));
      return new PrimitiveType(desc, desc);
    }
    const { raw, args } = desc;
    if (!args || Object.keys(args).length === 0) {
      const prim = this.primitives.get(raw);
      if (prim) return prim;
      if (raw.startsWith("?")) return new TypeVariable(raw.slice(1));
      return new PrimitiveType(raw, raw);
    }

    const template = this.parameterizedTemplates.get(raw);
    const parsedArgs = new Map<string, DataType>();
    for (const [key, childDesc] of Object.entries(args)) {
      parsedArgs.set(key, this.parse(childDesc));
    }
    return new ParameterizedType(
      raw,
      template?.name ?? raw,
      template?.description ?? "",
      parsedArgs,
    );
  }

  isCompatible(source: DataType, target: DataType): boolean {
    if (source instanceof TypeVariable && source.isBound()) {
      return this.isCompatible(source.resolved!, target);
    }
    if (target instanceof TypeVariable && target.isBound()) {
      return this.isCompatible(source, target.resolved!);
    }

    if (source.equals(target)) return true;

    if (source instanceof PrimitiveType && target instanceof PrimitiveType) {
      return target.isArgCompatibleWith(source.raw);
    }

    if (source instanceof ParameterizedType && target instanceof ParameterizedType) {
      if (source.raw !== target.raw) return false;
      if (source.args.size !== target.args.size) return false;
      for (const [paramName, sourceArg] of source.args) {
        const targetArg = target.getArg(paramName);
        if (!targetArg) return false;
        if (!this.isCompatible(sourceArg, targetArg)) return false;
      }
      return true;
    }

    return false;
  }

  static fromCatalog(catalog: Record<string, TypeCatalogEntry>): TypeSystem {
    const ts = new TypeSystem();
    for (const [raw, entry] of Object.entries(catalog)) {
      if (raw === "$schema") continue;
      if (entry.params) {
        ts.registerParameterized(
          raw,
          entry.name,
          entry.description ?? "",
          Object.keys(entry.params),
        );
      } else {
        ts.registerPrimitive(
          raw,
          entry.name,
          entry.description ?? "",
          entry.as_arg_compatible_with ?? [],
        );
      }
    }
    return ts;
  }

  static fromLibrary(library: { typeSystem: TypeSystem }): TypeSystem {
    return library.typeSystem;
  }
}
