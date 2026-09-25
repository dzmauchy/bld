/**
 * @title Clang AST Types
 *
 * Consumes `clang++ -Xclang -ast-dump=json -fparse-all-comments` output to
 * recover C++ types, detect incompatibilities, and read JSON comments.
 * No custom unification or port-type algebra, and no separate C++ parser.
 */
import { ClangAstDumper, type ClangDumpResult } from "./clangAstDumper.ts";

export type ClangAstLoc = {
  offset?: number;
  file?: string;
  line?: number;
  col?: number;
  tokLen?: number;
  includedFrom?: { file?: string };
};

export type ClangAstJson = {
  kind?: string;
  name?: string;
  text?: string;
  isImplicit?: boolean;
  loc?: ClangAstLoc;
  range?: { begin?: ClangAstLoc; end?: ClangAstLoc };
  type?: { qualType?: string; desugaredQualType?: string };
  inner?: ClangAstJson[];
  bases?: { type?: { qualType?: string } }[];
};

export class JsonComment {
  private constructor(readonly value: Record<string, unknown>) {}

  static fromText(text: string): JsonComment | undefined {
    let body = text.trim();
    if (body.startsWith("/*")) body = body.slice(2);
    else if (body.startsWith("//")) body = body.slice(2);
    else return undefined;
    if (body.endsWith("*/")) body = body.slice(0, -2);
    body = body.trim();
    return JsonComment.fromJsonBody(body);
  }

  static fromJsonBody(body: string): JsonComment | undefined {
    const trimmed = body.trim();
    if (!trimmed.startsWith("{")) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`C++ comment is not valid JSON: ${message}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return new JsonComment(parsed as Record<string, unknown>);
  }

  get kind(): string | undefined {
    return typeof this.value.kind === "string" ? this.value.kind : undefined;
  }
}

export class ClangComment {
  constructor(private readonly node: ClangAstJson) {}

  static of(decl: ClangAstJson): ClangComment | undefined {
    const full = (decl.inner ?? []).find((child) => child.kind === "FullComment");
    return full ? new ClangComment(full) : undefined;
  }

  texts(): string[] {
    const found: string[] = [];
    const walk = (node: ClangAstJson): void => {
      if (node.kind === "TextComment" && typeof node.text === "string") found.push(node.text);
      for (const child of node.inner ?? []) walk(child);
    };
    walk(this.node);
    return found;
  }

  joinedText(): string {
    return this.texts().join("");
  }

  asJson(): JsonComment | undefined {
    return JsonComment.fromJsonBody(this.joinedText());
  }
}

export class ClangSourceComments {
  static precedingBlockJson(source: string, declBeginOffset: number): JsonComment | undefined {
    let end = declBeginOffset;
    while (end > 0 && /\s/.test(source[end - 1] ?? "")) end -= 1;
    if (!source.endsWith("*/", end)) return undefined;
    const open = source.lastIndexOf("/*", end - 2);
    if (open === -1) return undefined;
    return JsonComment.fromText(source.slice(open, end));
  }

  static declBeginOffset(node: ClangAstJson): number | undefined {
    return node.range?.begin?.offset ?? node.loc?.offset;
  }
}

export function isMainFileNode(node: ClangAstJson, mainFile?: string): boolean {
  const loc = node.loc;
  const begin = node.range?.begin;
  if (loc?.includedFrom ?? begin?.includedFrom) return false;
  const file = loc?.file ?? begin?.file;
  if (!file) return true;
  if (!mainFile) return false;
  const base = mainFile.split(/[\\/]/).pop() ?? mainFile;
  return file === mainFile || file.endsWith(`/${base}`);
}

export class ClangQualType {
  constructor(
    readonly qualType: string,
    readonly desugaredQualType?: string,
  ) {}

  static fromAst(type: { qualType?: string; desugaredQualType?: string } | undefined): ClangQualType {
    return new ClangQualType(type?.qualType ?? "auto", type?.desugaredQualType);
  }

  get canonical(): string {
    return this.desugaredQualType ?? this.qualType;
  }

  get isVoid(): boolean {
    return /^void\b/.test(this.qualType.trim());
  }

  get isVectorized(): boolean {
    return /\bVectorizedInput\s*</.test(this.qualType) || /\bArray\s*</.test(this.canonical);
  }

  get isPointer(): boolean {
    return this.qualType.includes("*");
  }

  splitFunction(): { returnType: ClangQualType; parameters: ClangQualType[] } {
    const split = splitTopLevelParen(this.qualType);
    if (!split) return { returnType: this, parameters: [] };
    return {
      returnType: new ClangQualType(split.before.trim()),
      parameters: splitParams(split.inside).map((param) => new ClangQualType(param)),
    };
  }
}

export class ClangFunction {
  constructor(
    readonly name: string,
    readonly returnType: ClangQualType,
    readonly parameters: ClangQualType[],
  ) {}

  isCopyOrMoveOf(recordName: string): boolean {
    if (this.parameters.length !== 1) return false;
    const param = this.parameters[0]?.qualType ?? "";
    return param === `const ${recordName} &` || param === `${recordName} &&`;
  }
}

export class ClangRecord {
  constructor(
    readonly name: string,
    readonly qualifiedName: string,
    readonly bases: readonly string[],
    readonly constructors: readonly ClangFunction[],
    readonly methods: readonly ClangFunction[],
  ) {}

  method(name: string): ClangFunction | undefined {
    return this.methods.find((method) => method.name === name);
  }

  primaryConstructor(): ClangFunction | undefined {
    const ctors = this.constructors.filter((ctor) => !ctor.isCopyOrMoveOf(this.name));
    if (ctors.length === 0) return undefined;
    return ctors.reduce((best, ctor) => (ctor.parameters.length > best.parameters.length ? ctor : best));
  }
}

export class ClangTranslationUnit {
  constructor(private readonly records: Map<string, ClangRecord>, private readonly variables: Map<string, ClangQualType>) {}

  static parse(ast: unknown): ClangTranslationUnit {
    const records = new Map<string, ClangRecord>();
    const variables = new Map<string, ClangQualType>();
    walk(ast as ClangAstJson, [], records, variables);
    return new ClangTranslationUnit(records, variables);
  }

  record(qualifiedName: string): ClangRecord | undefined {
    return this.records.get(qualifiedName) ?? this.records.get(qualifiedName.replace(/::/g, "."));
  }

  resolveMethod(qualifiedClass: string, methodName: string, seen = new Set<string>()): ClangFunction | undefined {
    const key = qualifiedClass.replace(/::/g, ".");
    if (seen.has(key)) return undefined;
    seen.add(key);
    const record = this.record(key);
    if (!record) return undefined;
    const direct = record.method(methodName);
    if (direct) return direct;
    for (const base of record.bases) {
      const inherited = this.resolveMethod(this.resolveBaseName(record, base), methodName, seen);
      if (inherited) return inherited;
    }
    return undefined;
  }

  private resolveBaseName(record: ClangRecord, base: string): string {
    const dotted = base.replace(/::/g, ".");
    if (this.record(dotted)) return dotted;
    const parts = record.qualifiedName.split(".");
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const candidate = [...parts.slice(0, i), dotted].join(".");
      if (this.record(candidate)) return candidate;
    }
    return dotted;
  }

  varType(name: string): ClangQualType | undefined {
    return this.variables.get(name);
  }
}

export class ClangApplyShape {
  constructor(
    readonly apply: ClangFunction,
    readonly connectPin: ClangFunction | undefined,
    readonly ctor: ClangFunction | undefined,
  ) {}

  get registersHostPins(): boolean {
    return this.connectPin !== undefined;
  }

  get returnsVoid(): boolean {
    return this.apply.returnType.qualType === "void";
  }

  get returnsVector(): boolean {
    return this.apply.returnType.isVectorized;
  }

  get returnsScalarConsumer(): boolean {
    return this.apply.returnType.isPointer && !this.apply.returnType.isVectorized;
  }

  get exposesConsumerBank(): boolean {
    return this.returnsVector && this.downstreamType() === undefined;
  }

  get returnsIndexedConsumers(): boolean {
    return this.returnsVector && this.downstreamType() !== undefined;
  }

  get appliesDownstream(): boolean {
    return this.downstreamType() !== undefined && !this.registersHostPins;
  }

  downstreamType(): ClangQualType | undefined {
    const fromApply = this.apply.parameters.find((param) => param.isVectorized);
    if (fromApply) return fromApply;
    return this.connectPin?.parameters.find((param) => param.isVectorized);
  }

  streamCppType(): string {
    const downstream = this.downstreamType();
    if (downstream) return downstream.qualType;
    if (this.returnsVector) return this.apply.returnType.qualType;
    throw new Error("C++ apply signature has no stream type");
  }
}

export class ClangTypeCatalog {
  private unit: ClangTranslationUnit | undefined;
  private readonly shapes = new Map<string, ClangApplyShape>();

  constructor(
    private readonly dumper?: ClangAstDumper,
    private readonly libraryFiles: Record<string, string> = {},
  ) {}

  private getDumper(): ClangAstDumper {
    return this.dumper ?? ClangAstDumper.defaultDumper();
  }

  private nativeFiles(): Record<string, string> {
    return this.libraryFiles["base.hpp"] ? this.libraryFiles : ClangAstDumper.libraryFiles;
  }

  ensure(): ClangTranslationUnit {
    if (this.unit) return this.unit;
    const library = this.nativeFiles();
    const files = new Map<string, string>([
      ["bld.hpp", library["bld.hpp"] ?? ""],
      ["base.hpp", library["base.hpp"] ?? ""],
      ["probe.cpp", '#include "base.hpp"\n'],
    ]);
    const dump = this.getDumper().dump(files, "probe.cpp");
    if (!dump.ok || dump.ast === undefined) {
      throw new Error(`clang++ AST dump of the C++ library failed\n${dump.diagnostics}`);
    }
    this.unit = ClangTranslationUnit.parse(dump.ast);
    return this.unit;
  }

  shapeFor(cppClass: string): ClangApplyShape {
    const cached = this.shapes.get(cppClass);
    if (cached) return cached;
    const unit = this.ensure();
    const apply = unit.resolveMethod(cppClass, "apply");
    if (!apply) throw new Error(`No apply() method on ${cppClass} in clang AST`);
    const record = unit.record(cppClass.replace(/::/g, "."));
    const shape = new ClangApplyShape(
      apply,
      unit.resolveMethod(cppClass, "connectPin"),
      record?.primaryConstructor(),
    );
    this.shapes.set(cppClass, shape);
    return shape;
  }

  dumpProbe(source: string): ClangDumpResult {
    const library = this.nativeFiles();
    const files = new Map<string, string>([
      ["bld.hpp", library["bld.hpp"] ?? ""],
      ["base.hpp", library["base.hpp"] ?? ""],
      ["wasm_host.hpp", library["wasm_host.hpp"] ?? ""],
      ["probe.cpp", prepareProbeSource(source)],
    ]);
    return this.getDumper().dump(files, "probe.cpp");
  }
}

function prepareProbeSource(source: string): string {
  if (source.includes("using push::f32::F32")) return source;
  if (source.includes('#include "base.hpp"')) {
    return source.replace('#include "base.hpp"', '#include "base.hpp"\nusing push::f32::F32;');
  }
  return `#include "base.hpp"\nusing push::f32::F32;\n${source}`;
}

function walk(
  node: ClangAstJson | undefined,
  namespace: string[],
  records: Map<string, ClangRecord>,
  variables: Map<string, ClangQualType>,
): void {
  if (!node) return;
  const kind = node.kind;
  const name = node.name;
  const nextNs = kind === "NamespaceDecl" && name ? [...namespace, name] : namespace;

  if (kind === "CXXRecordDecl" && name && node.inner) {
    const qualified = [...nextNs, name].join(".");
    const bases = (node.bases ?? []).map((base) => (base.type?.qualType ?? "").replace(/::/g, ".")).filter(Boolean);
    const constructors: ClangFunction[] = [];
    const methods: ClangFunction[] = [];
    for (const child of node.inner) {
      if (child.kind === "CXXConstructorDecl" && child.name) {
        constructors.push(functionFromAst(child.name, child));
      } else if (child.kind === "CXXMethodDecl" && child.name) {
        methods.push(functionFromAst(child.name, child));
      }
    }
    if (!records.has(qualified) || methods.length > 0 || constructors.length > 0) {
      records.set(qualified, new ClangRecord(name, qualified, bases, constructors, methods));
    }
    for (const child of node.inner) walk(child, [...nextNs, name], records, variables);
    return;
  }

  if (kind === "VarDecl" && name) {
    variables.set(name, ClangQualType.fromAst(node.type));
  }

  for (const child of node.inner ?? []) walk(child, nextNs, records, variables);
}

function functionFromAst(name: string, node: ClangAstJson): ClangFunction {
  const parsed = ClangQualType.fromAst(node.type).splitFunction();
  const params = (node.inner ?? [])
    .filter((child) => child.kind === "ParmVarDecl")
    .map((child) => ClangQualType.fromAst(child.type));
  return new ClangFunction(name, parsed.returnType, params.length > 0 ? params : parsed.parameters);
}

function splitTopLevelParen(qualType: string): { before: string; inside: string } | undefined {
  let depth = 0;
  for (let i = 0; i < qualType.length; i += 1) {
    const ch = qualType[i];
    if (ch === "<") depth += 1;
    else if (ch === ">") depth -= 1;
    else if (ch === "(" && depth === 0) {
      const close = findMatching(qualType, i);
      if (close === -1) return undefined;
      return { before: qualType.slice(0, i), inside: qualType.slice(i + 1, close) };
    }
  }
  return undefined;
}

function findMatching(text: string, open: number): number {
  let paren = 0;
  let angle = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "<") angle += 1;
    else if (ch === ">" && angle > 0) angle -= 1;
    else if (angle === 0 && ch === "(") paren += 1;
    else if (angle === 0 && ch === ")") {
      paren -= 1;
      if (paren === 0) return i;
    }
  }
  return -1;
}

function splitParams(inside: string): string[] {
  if (!inside.trim()) return [];
  const params: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inside.length; i += 1) {
    const ch = inside[i];
    if (ch === "<" || ch === "(") depth += 1;
    else if (ch === ">" || ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      params.push(inside.slice(start, i).trim());
      start = i + 1;
    }
  }
  params.push(inside.slice(start).trim());
  return params.filter(Boolean);
}
