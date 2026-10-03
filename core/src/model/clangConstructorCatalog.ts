/**
 * Reads block constructor parameters from a Clang AST.
 * Release metadata names the parameters. Clang supplies their types and defaults.
 */
import type { ClangAstJson } from "cpp";

export interface ConstructorParameter {
  readonly name: string;
  readonly type: string;
  readonly defaultValue: unknown;
}

interface SpecializationRecord {
  readonly qualifiedName: string;
  readonly args: readonly string[];
  readonly parameters: readonly ConstructorParameter[] | undefined;
}

export class ClangConstructorCatalog {
  private constructor(
    private readonly aliases: ReadonlyMap<string, string>,
    private readonly records: ReadonlyMap<string, readonly string[]>,
    private readonly declared: ReadonlyMap<string, readonly ConstructorParameter[]>,
    private readonly specializations: readonly SpecializationRecord[],
    private readonly primary: ReadonlyMap<string, readonly ConstructorParameter[]>,
  ) {}

  static fromAst(ast: ClangAstJson): ClangConstructorCatalog {
    const aliases = new Map<string, string>();
    const records = new Map<string, readonly string[]>();
    const declared = new Map<string, readonly ConstructorParameter[]>();
    const specializations: SpecializationRecord[] = [];
    const primary = new Map<string, readonly ConstructorParameter[]>();
    const walk = (node: ClangAstJson, namespaceParts: readonly string[]): void => {
      const next = node.kind === "NamespaceDecl" && node.name ? [...namespaceParts, node.name] : namespaceParts;
      const qualified = node.name ? qualify(next, node.name) : "";
      if ((node.kind === "TypeAliasDecl" || node.kind === "TypedefDecl") && node.name) {
        const desugared = node.type?.desugaredQualType ?? node.type?.qualType;
        if (desugared) aliases.set(qualified, desugared);
      }
      if (node.kind === "CXXRecordDecl" && node.name && isComplete(node)) {
        records.set(qualified, basesOf(node));
        const params = explicitParameters(node);
        if (params) declared.set(qualified, params);
      }
      if (node.kind === "ClassTemplateDecl" && node.name) {
        for (const child of node.inner ?? []) {
          if (child.kind !== "CXXRecordDecl") continue;
          const params = explicitParameters(child);
          if (params) primary.set(qualified, params);
        }
      }
      if (node.kind === "ClassTemplateSpecializationDecl" && node.name) {
        const args = (node.inner ?? [])
          .filter((child) => child.kind === "TemplateArgument")
          .map((child) => child.type?.qualType ?? "");
        specializations.push({ qualifiedName: qualified, args, parameters: explicitParameters(node) });
      }
      for (const child of node.inner ?? []) walk(child, next);
    };
    walk(ast, []);
    return new ClangConstructorCatalog(aliases, records, declared, specializations, primary);
  }

  parametersFor(cppClass: string): readonly ConstructorParameter[] | undefined {
    const alias = this.aliases.get(cppClass);
    if (alias) return this.parametersOfType(alias);
    if (this.records.has(cppClass)) return this.parametersOfRecord(cppClass);
    return undefined;
  }

  private parametersOfRecord(cppClass: string): readonly ConstructorParameter[] | undefined {
    const own = this.declared.get(cppClass);
    if (own && own.length > 0) return own;
    let sawResolved = false;
    for (const base of this.records.get(cppClass) ?? []) {
      const found = this.parametersOfType(base);
      if (!found) continue;
      if (found.length > 0) return found;
      sawResolved = true;
    }
    if (own) return own;
    return sawResolved ? [] : undefined;
  }

  private parametersOfType(qualType: string): readonly ConstructorParameter[] | undefined {
    const parsed = TemplateId.parse(qualType);
    if (!parsed) return undefined;
    const matches = this.specializations.filter((spec) =>
      spec.qualifiedName === parsed.name && sameArgs(spec.args, parsed.args));
    const defined = matches.filter((spec) => spec.parameters);
    const rich = defined.find((spec) => (spec.parameters?.length ?? 0) > 0);
    if (rich?.parameters) return rich.parameters;
    if (defined.length > 0) return defined[0]?.parameters ?? [];
    const primary = this.primary.get(parsed.name);
    if (!primary || primary.some((param) => isDependentType(param.type))) {
      return matches.length > 0 ? [] : undefined;
    }
    return primary;
  }
}

class TemplateId {
  private constructor(readonly name: string, readonly args: readonly string[]) {}

  static parse(qualType: string): TemplateId | undefined {
    const open = qualType.indexOf("<");
    const close = qualType.lastIndexOf(">");
    if (open < 0 || close < open) return undefined;
    const name = qualType.slice(0, open).trim();
    if (!name) return undefined;
    return new TemplateId(name, splitArgs(qualType.slice(open + 1, close)));
  }
}

function qualify(namespaceParts: readonly string[], name: string): string {
  return [...namespaceParts, name].join("::");
}

function isComplete(node: ClangAstJson): boolean {
  return (node as ClangAstJson & { completeDefinition?: boolean }).completeDefinition === true;
}

function basesOf(node: ClangAstJson): string[] {
  return (node.bases ?? [])
    .map((base) => {
      const type = base.type as { qualType?: string; desugaredQualType?: string } | undefined;
      return type?.desugaredQualType ?? type?.qualType ?? "";
    })
    .filter((type) => type.length > 0);
}

function explicitParameters(node: ClangAstJson): readonly ConstructorParameter[] | undefined {
  const constructors = (node.inner ?? []).filter((child) => child.kind === "CXXConstructorDecl" && !child.isImplicit);
  const constructor = constructors.find((decl) =>
    decl.inner?.some((child) => child.kind === "ParmVarDecl" && child.name === "blockId"));
  if (!constructor) return undefined;
  const parameters: ConstructorParameter[] = [];
  for (const child of constructor.inner ?? []) {
    if (child.kind !== "ParmVarDecl" || !child.name || child.name === "blockId") continue;
    const type = concreteType(child);
    let value = defaultValue(child);
    if (Array.isArray(value) && !/\bArray\s*</.test(type) && value.length === 1) value = value[0];
    parameters.push({
      name: child.name,
      type,
      defaultValue: value,
    });
  }
  return parameters;
}

function concreteType(node: ClangAstJson): string {
  const desugared = node.type?.desugaredQualType;
  const qualType = node.type?.qualType ?? "auto";
  if (desugared && !isDependentType(desugared)) return desugared;
  return qualType;
}

function isDependentType(type: string): boolean {
  return /typename|type-parameter|\bauto\b/.test(type);
}

function sameArgs(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((arg, index) => normalize(arg) === normalize(right[index] ?? ""));
}

function normalize(type: string): string {
  return type.replace(/\s+/g, "");
}

function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index];
    if (char === "<") depth++;
    else if (char === ">") depth--;
    else if (char === "," && depth === 0) {
      args.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last) args.push(last);
  return args;
}

function defaultValue(node: ClangAstJson): unknown {
  const literal = node as ClangAstJson & { value?: string | boolean; opcode?: string };
  if (literal.kind === "IntegerLiteral" || literal.kind === "FloatingLiteral") return Number(literal.value);
  if (literal.kind === "CXXBoolLiteralExpr") return literal.value;
  if (literal.kind === "InitListExpr") return literal.inner?.map(defaultValue);
  if (literal.kind === "UnaryOperator" && literal.opcode === "-") {
    const inner = literal.inner?.[0];
    return inner ? -Number(defaultValue(inner)) : undefined;
  }
  for (const child of literal.inner ?? []) {
    const value = defaultValue(child);
    if (value !== undefined) return value;
  }
  return undefined;
}
