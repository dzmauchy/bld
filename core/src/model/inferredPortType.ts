/**
 * Port type recovered from a clang QualType for a diagram port.
 * Vector length comes from the diagram, not from the dump.
 */
import type { ClangQualType } from "cpp";

export class InferredPortType {
  constructor(
    readonly clangType: ClangQualType,
    readonly isVector: boolean,
    readonly vectorLength?: number,
  ) {}

  get qualType(): string {
    const raw = this.clangType.qualType;
    if (raw === "auto" || raw.startsWith("decltype")) return this.clangType.canonical;
    return raw;
  }

  get desugaredQualType(): string {
    return this.clangType.canonical;
  }

  withVectorLength(length: number | undefined): InferredPortType {
    const vectorLength = length !== undefined && length > 0 ? length : this.vectorLength;
    return new InferredPortType(this.clangType, this.isVector || (vectorLength !== undefined && vectorLength > 1), vectorLength);
  }
}
