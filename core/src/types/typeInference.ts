import {
  DataType,
  ParameterizedType,
  PrimitiveType,
  TypeVariable,
} from "./types";
import { TypeSystem } from "./typeSystem";

export interface InferredPortType {
  dataType: DataType;
  payloadType?: DataType | undefined;
  isStream: boolean;
  isVector: boolean;
  vectorLength?: number | undefined;
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

export interface RawPortLike {
  type: DataType;
  vector?: boolean;
  concept?: unknown;
}

export class TypeInference {
  constructor(readonly typeSystem: TypeSystem = new TypeSystem()) {}

  /**
   * Infers the concrete port type, unwrapped payload type, and vector cardinality
   * based on the port definition and any bound configuration values.
   */
  inferPort(port: RawPortLike, blockConf?: Record<string, unknown>): InferredPortType {
    const dataType = port.type;
    const isStream = this.isStreamType(dataType);
    const payloadType = this.inferPayloadType(dataType);
    let vectorLength: number | undefined;

    // Check if concept binds length to a configuration parameter (e.g. gpio_in pins array)
    const concept = port.concept as { length?: { bind?: { type?: string; id?: string } } } | undefined;
    const bind = concept?.length?.bind;
    if (bind && bind.type === "conf" && bind.id && blockConf) {
      const confVal = blockConf[bind.id];
      if (Array.isArray(confVal)) {
        vectorLength = confVal.length;
      }
    }

    return {
      dataType,
      payloadType,
      isStream,
      isVector: Boolean(port.vector || (vectorLength !== undefined && vectorLength > 1)),
      vectorLength,
    };
  }

  /**
   * Unwraps nested stream/array wrapper types to find the innermost payload data type.
   * e.g., pss<f32> -> f32, array<pss<f32>> -> f32
   */
  inferPayloadType(type: DataType): DataType | undefined {
    if (type instanceof ParameterizedType) {
      if (type.raw === "pss") {
        return type.getArg("T");
      }
      if (type.raw === "array") {
        const itemType = type.getArg("T");
        if (itemType) return this.inferPayloadType(itemType) ?? itemType;
      }
    }
    return undefined;
  }

  /**
   * Checks if a type is a push stream (pss).
   */
  isStreamType(type: DataType): boolean {
    if (type instanceof ParameterizedType) {
      if (type.raw === "pss") return true;
      if (type.raw === "array") {
        const itemType = type.getArg("T");
        return itemType ? this.isStreamType(itemType) : false;
      }
    }
    return false;
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

    for (const [primary, secondary] of [[fromType, toType], [toType, fromType]]) {
      if (this.unify(primary, secondary).ok) {
        return {
          ok: true,
          effectiveType: primary,
          payloadType: this.inferPayloadType(primary),
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
