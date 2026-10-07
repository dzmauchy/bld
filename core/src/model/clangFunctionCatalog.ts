/** Release metadata names factory parameters; Clang supplies types and defaults. */
import type { ClangAstJson } from "cpp";

export interface FunctionParameter {
  readonly name: string;
  readonly type: string;
  readonly defaultValue: unknown;
}

export class ClangFunctionCatalog {
  private constructor(
    private readonly declared: ReadonlyMap<string, readonly FunctionParameter[]>,
    private readonly called: ReadonlyMap<string, readonly FunctionParameter[]>,
  ) {}

  static fromAst(ast: ClangAstJson): ClangFunctionCatalog {
    const declared = new Map<string, readonly FunctionParameter[]>();
    const called = new Map<string, readonly FunctionParameter[]>();
    const walk = (node: ClangAstJson, namespace: readonly string[]): void => {
      const next = node.kind === "NamespaceDecl" && node.name ? [...namespace, node.name] : namespace;
      if (node.kind === "FunctionDecl" && node.name) {
        const parameters = (node.inner ?? []).filter((child) => child.kind === "ParmVarDecl");
        if (parameters[0]?.name === "blockId") {
          declared.set([...next, node.name].join("::"), parameters.slice(1).map((param) => parameter(param, param.name ?? "")));
        }
      }
      // Fall back to the factory call's default arguments when its declaration is absent.
      // Named block variables identify the exact factory, even when several factories return the same callable type.
      if (node.kind === "VarDecl" && /^b\d+$/.test(node.name ?? "")) {
        const call = factoryCall(node);
        if (call) called.set(node.name!, (call.inner ?? []).slice(2).map((arg) => parameter(arg, "")));
      }
      for (const child of node.inner ?? []) walk(child, next);
    };
    walk(ast, []);
    return new ClangFunctionCatalog(declared, called);
  }

  parametersFor(factory: string): readonly FunctionParameter[] | undefined {
    return this.declared.get(factory);
  }

  calledParameters(variable: string): readonly FunctionParameter[] | undefined {
    return this.called.get(variable);
  }
}

function factoryCall(node: ClangAstJson): ClangAstJson | undefined {
  if (node.kind === "CallExpr") return node;
  for (const child of node.inner ?? []) {
    const call = factoryCall(child);
    if (call) return call;
  }
  return undefined;
}

function parameter(node: ClangAstJson, name: string): FunctionParameter {
  const type = node.type?.desugaredQualType ?? node.type?.qualType ?? "auto";
  let value = defaultValue(node);
  if (Array.isArray(value) && !/\barray\s*</.test(type) && value.length === 1) value = value[0];
  return { name, type, defaultValue: value };
}

function defaultValue(node: ClangAstJson): unknown {
  const literal = node as ClangAstJson & { value?: string | boolean; opcode?: string };
  if (literal.kind === "IntegerLiteral" || literal.kind === "FloatingLiteral") return Number(literal.value);
  if (literal.kind === "CXXBoolLiteralExpr") return literal.value;
  if ((literal.kind === "CXXConstructExpr" || literal.kind === "CXXTemporaryObjectExpr")
    && /\bcore::array\s*</.test(literal.type?.desugaredQualType ?? literal.type?.qualType ?? "")) {
    const args = (literal.inner ?? []).map(defaultValue);
    if (args.length === 0) return [];
    if (Array.isArray(args[0])) return args[0];
    const count = args[0];
    const value = Array.isArray(args[1]) && args[1].length === 1 ? args[1][0] : args[1] ?? 0;
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) return Array(count).fill(value);
    return undefined;
  }
  if (literal.kind === "InitListExpr") return literal.inner?.map(defaultValue) ?? [];
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
