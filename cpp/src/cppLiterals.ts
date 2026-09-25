/**
 * Formats C++ literals from clang QualTypes. Callers supply the values;
 * this class does not know diagrams, blocks, or ports.
 */
export class CppTypeNames {
  static literalFromClang(qualType: string, value: unknown): string {
    if (/\bArray\s*</.test(qualType)) {
      throw new Error("Array values must be emitted as named arrays");
    }
    if (/\b(f32|F32|float)\b/.test(qualType)) return f32Lit(Number(value));
    if (/\b(f64|F64|double)\b/.test(qualType)) {
      const n = Number(value);
      return Number.isInteger(n) ? `${n}.0` : String(n);
    }
    if (/\bbool\b/.test(qualType)) return value ? "true" : "false";
    const n = Number(value);
    if (/\b(u32|unsigned int)\b/.test(qualType)) return `${Math.trunc(n)}u`;
    return String(Math.trunc(n));
  }

  static isArrayQualType(qualType: string): boolean {
    return /\bArray\s*</.test(qualType);
  }
}

export function cppIdent(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `b_${cleaned}`;
}

function f32Lit(value: number): string {
  if (Object.is(value, -0)) return "-0.f";
  if (Number.isInteger(value)) return `${value}.f`;
  return `${value}f`;
}
