import {
  DataType,
  ParameterizedType,
  PrimitiveType,
  TypeVariable,
} from "./types";
import { TypeSystem } from "./typeSystem";

export interface ConfLengthBind {
  readonly type: string;
  readonly id?: string;
}

export interface RawPortLike {
  type: DataType;
  vector?: boolean;
  concept?: unknown;
}

export class InferredPortType {
  constructor(
    readonly dataType: DataType,
    readonly payloadType: DataType | undefined,
    readonly isStream: boolean,
    readonly isVector: boolean,
    readonly vectorLength?: number,
  ) {}

  withType(dataType: DataType, inference: TypeInference): InferredPortType {
    return new InferredPortType(
      dataType,
      inference.inferPayloadType(dataType),
      inference.isStreamType(dataType),
      this.isVector,
      this.vectorLength,
    );
  }

  withVectorLength(length: number | undefined): InferredPortType {
    const vectorLength = length !== undefined && length > 0 ? length : this.vectorLength;
    return new InferredPortType(
      this.dataType,
      this.payloadType,
      this.isStream,
      this.isVector || (vectorLength !== undefined && vectorLength > 1),
      vectorLength,
    );
  }
}

export interface UnificationResult {
  ok: boolean;
  bindings: Map<string, DataType>;
  reason?: string | undefined;
}

export interface ConnectionInferenceResult {
  ok: boolean;
  effectiveType?: DataType | undefined;
  payloadType?: DataType | undefined;
  error?: string | undefined;
}

export function confLengthBind(port: RawPortLike): ConfLengthBind | undefined {
  const concept = port.concept as { length?: { bind?: ConfLengthBind } } | undefined;
  const bind = concept?.length?.bind;
  if (!bind || typeof bind.type !== "string") return undefined;
  return bind;
}

export function confLengthBindId(port: RawPortLike): string | undefined {
  const bind = confLengthBind(port);
  return bind?.type === "conf" && bind.id ? bind.id : undefined;
}

export class TypeInference {
  constructor(readonly typeSystem: TypeSystem = new TypeSystem()) {}

  /**
   * Infers the concrete port type, unwrapped payload type, and vector cardinality
   * based on the port definition and any bound configuration values.
   */
  inferPort(port: RawPortLike, blockConf?: Record<string, unknown>): InferredPortType {
    const dataType = port.type;
    const bindId = confLengthBindId(port);
    let vectorLength: number | undefined;
    if (bindId && blockConf) {
      const confVal = blockConf[bindId];
      if (Array.isArray(confVal)) vectorLength = confVal.length;
    }

    return new InferredPortType(
      dataType,
      this.inferPayloadType(dataType),
      this.isStreamType(dataType),
      Boolean(port.vector || (vectorLength !== undefined && vectorLength > 1)),
      vectorLength,
    );
  }

  unwrapArray(type: DataType): DataType {
    return type instanceof ParameterizedType && type.raw === "array" && type.getArg("T")
      ? this.unwrapArray(type.getArg("T")!)
      : type;
  }

  /**
   * Unwraps nested stream/array wrapper types to find the innermost payload data type.
   * e.g., pss<f32> -> f32, array<pss<f32>> -> f32
   */
  inferPayloadType(type: DataType): DataType | undefined {
    const inner = this.unwrapArray(type);
    return inner instanceof ParameterizedType && inner.raw === "pss" ? inner.getArg("T") : undefined;
  }

  /**
   * Checks if a type is a push stream (pss).
   */
  isStreamType(type: DataType): boolean {
    return this.inferPayloadType(type) !== undefined;
  }

  /**
   * Replaces bound type variables inside a type using unification bindings.
   */
  substitute(type: DataType, bindings: ReadonlyMap<string, DataType>): DataType {
    if (type instanceof TypeVariable) {
      const bound = bindings.get(type.name) ?? type.resolved;
      return bound ? this.substitute(bound, bindings) : type;
    }
    if (type instanceof ParameterizedType) {
      const args = new Map<string, DataType>();
      for (const [name, arg] of type.args) {
        args.set(name, this.substitute(arg, bindings));
      }
      return new ParameterizedType(type.raw, type.name, type.description, args);
    }
    return type;
  }

  /**
   * Unifies two types, resolving any generic type variables.
   */
  unify(
    source: DataType,
    target: DataType,
    initialBindings = new Map<string, DataType>(),
  ): UnificationResult {
    const bindings = new Map<string, DataType>(initialBindings);

    const resolve = (t: DataType): DataType => {
      if (t instanceof TypeVariable && bindings.has(t.name)) {
        return bindings.get(t.name)!;
      }
      return t;
    };

    const s = resolve(source);
    const t = resolve(target);

    if (t instanceof TypeVariable) {
      bindings.set(t.name, s);
      return { ok: true, bindings };
    }

    if (s instanceof TypeVariable) {
      bindings.set(s.name, t);
      return { ok: true, bindings };
    }

    if (s.equals(t)) {
      return { ok: true, bindings };
    }

    if (s instanceof PrimitiveType && t instanceof PrimitiveType) {
      if (this.typeSystem.isCompatible(s, t)) {
        return { ok: true, bindings };
      }
      return {
        ok: false,
        bindings,
        reason: `Primitive type ${s.raw} is not compatible with ${t.raw}`,
      };
    }

    if (s instanceof ParameterizedType && t instanceof ParameterizedType) {
      if (s.raw !== t.raw) {
        return {
          ok: false,
          bindings,
          reason: `Mismatched generic constructors ${s.raw} vs ${t.raw}`,
        };
      }

      for (const [paramName, sourceArg] of s.args) {
        const targetArg = t.getArg(paramName);
        if (!targetArg) {
          return {
            ok: false,
            bindings,
            reason: `Missing parameter ${paramName} in target`,
          };
        }
        const childRes = this.unify(sourceArg, targetArg, bindings);
        if (!childRes.ok) return childRes;
        for (const [k, v] of childRes.bindings) {
          bindings.set(k, v);
        }
      }
      return { ok: true, bindings };
    }

    return {
      ok: false,
      bindings,
      reason: `Cannot unify ${s.toString()} with ${t.toString()}`,
    };
  }

  /**
   * Infers whether a connection can be established between two endpoints
   * and determines the effective transmitted type.
   */
  inferConnection(
    from: InferredPortType | DataType,
    to: InferredPortType | DataType,
  ): ConnectionInferenceResult {
    const fromType = from instanceof DataType ? from : from.dataType;
    const toType = to instanceof DataType ? to : to.dataType;

    if (this.typeSystem.isCompatible(fromType, toType) || this.typeSystem.isCompatible(toType, fromType)) {
      return {
        ok: true,
        effectiveType: fromType,
        payloadType: this.inferPayloadType(fromType) ?? this.inferPayloadType(toType),
      };
    }

    for (const [primary, secondary] of [
      [fromType, toType],
      [toType, fromType],
    ]) {
      const unified = this.unify(primary, secondary);
      if (unified.ok) {
        const effective = this.substitute(primary, unified.bindings);
        return {
          ok: true,
          effectiveType: effective,
          payloadType: this.inferPayloadType(effective),
        };
      }
    }

    return {
      ok: false,
      error: `Incompatible types: ${fromType.toString()} and ${toType.toString()}`,
    };
  }

  /**
   * Infers the DataType of a literal JSON configuration value.
   */
  inferLiteralType(value: unknown): DataType {
    if (typeof value === "boolean") return this.typeSystem.parse("bool");
    if (typeof value === "number") {
      return this.typeSystem.parse(!Number.isInteger(value) ? "f32" : value >= 0 && value <= 255 ? "u8" : "u32");
    }
    if (typeof value === "string") return this.typeSystem.parse("str");
    if (Array.isArray(value)) {
      const elemType = value.length === 0 ? this.typeSystem.parse("u8") : this.inferLiteralType(value[0]);
      return new ParameterizedType("array", "Array", "", new Map([["T", elemType]]));
    }
    return this.typeSystem.parse("any");
  }
}
