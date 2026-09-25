/**
 * @title Clang AST Types
 *
 * Consumes `clang++ -Xclang -ast-dump=json` output to recover C++ types,
 * detect incompatibilities, and read javadoc comments.
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
  bases?: { type?: { qualType?: string; desugaredQualType?: string } }[];
  referencedDecl?: { kind?: string; name?: string; type?: { qualType?: string; desugaredQualType?: string } };
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
    return /\bVectorized\s*</.test(this.qualType) || /\bVectorized\s*</.test(this.canonical);
  }

  get isStream(): boolean {
    return this.isVectorized || (this.isPointer && !this.isVectorized);
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
    readonly parameterNames: readonly string[] = [],
  ) {}

  streamParameters(): { name: string; type: ClangQualType }[] {
    return this.parameters.flatMap((type, index) => {
      if (!type.isStream) return [];
      return [{ name: this.parameterNames[index] || `arg${index}`, type }];
    });
  }

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

  instantiatedMethod(classSpelling: string, methodName: string): ClangFunction | undefined {
    return this.record(classKey(classSpelling))?.method(methodName);
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
    const files = new Map<string, string>(Object.entries(library));
    files.set("probe.cpp", library["base.hpp"] ? '#include "base.hpp"\n' : includeAllHeaders(library));
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
    const signature = this.signatureFor(cppClass);
    const apply = signature?.apply ?? unit.resolveMethod(cppClass, "apply");
    if (!apply) throw new Error(`No apply() method on ${cppClass} in clang AST`);
    const record = unit.record(cppClass.replace(/::/g, "."));
    const connectPin = signature ? signature.connectPin : unit.resolveMethod(cppClass, "connectPin");
    const shape = new ClangApplyShape(apply, connectPin, record?.primaryConstructor());
    this.shapes.set(cppClass, shape);
    return shape;
  }

  dumpProbe(source: string): ClangDumpResult {
    const library = this.nativeFiles();
    const files = new Map<string, string>(Object.entries(library));
    files.set("probe.cpp", prepareProbeSource(source));
    return this.getDumper().dump(files, "probe.cpp");
  }

  private resolved = new Map<string, ResolvedApply>();

  bindResolved(signatures: ReadonlyMap<string, ResolvedApply>): void {
    this.resolved = new Map(signatures);
    for (const [cppClass, signature] of signatures) ClangTypeCatalog.sharedSignatures.set(cppClass, signature);
    this.shapes.clear();
  }

  private static readonly sharedSignatures = new Map<string, ResolvedApply>();

  private signatureFor(cppClass: string): ResolvedApply | undefined {
    return this.resolved.get(cppClass) ?? ClangTypeCatalog.sharedSignatures.get(cppClass);
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

  if ((kind === "CXXRecordDecl" || kind === "ClassTemplateSpecializationDecl") && name && node.inner) {
    const args = kind === "ClassTemplateSpecializationDecl" ? templateArgumentSuffix(node) : "";
    const qualified = classKey([...nextNs, `${name}${args}`].join("."));
    const bases = (node.bases ?? []).map((base) => baseRecordName(base)).filter(Boolean);
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
    for (const child of node.inner) walk(child, [...nextNs, `${name}${args}`], records, variables);
    return;
  }

  if (kind === "VarDecl" && name) {
    variables.set(name, ClangQualType.fromAst(node.type));
  }

  for (const child of node.inner ?? []) walk(child, nextNs, records, variables);
}

function functionFromAst(name: string, node: ClangAstJson): ClangFunction {
  const parsed = ClangQualType.fromAst(node.type).splitFunction();
  const decls = (node.inner ?? []).filter((child) => child.kind === "ParmVarDecl");
  const params = decls.map((child) => ClangQualType.fromAst(child.type));
  const names = decls.map((child) => child.name ?? "");
  return new ClangFunction(
    name,
    parsed.returnType,
    params.length > 0 ? params : parsed.parameters,
    names,
  );
}

function baseRecordName(base: { type?: { qualType?: string; desugaredQualType?: string } }): string {
  const raw = base.type?.desugaredQualType || base.type?.qualType || "";
  const head = raw.split("<")[0] ?? "";
  return head.replace(/::/g, ".").replace(/\s+/g, "").trim();
}

function includeAllHeaders(library: Record<string, string>): string {
  return Object.keys(library)
    .filter((name) => /\.(?:h|hh|hpp|hxx)$/i.test(name))
    .map((name) => `#include "${name}"`)
    .join("\n");
}

export type ResolvedApply = {
  apply: ClangFunction;
  connectPin?: ClangFunction;
};

export class MemberPointerType {
  static parse(qualType: string): { className: string; returnType: ClangQualType; parameters: ClangQualType[] } | undefined {
    const marker = qualType.indexOf("::*)");
    if (marker < 0) return undefined;
    const open = qualType.lastIndexOf("(", marker);
    if (open < 0) return undefined;
    const className = qualType.slice(open + 1, marker).trim();
    const returnType = qualType.slice(0, open).trim();
    const rest = qualType.slice(marker + "::*)".length);
    const paramsOpen = rest.indexOf("(");
    const paramsClose = rest.lastIndexOf(")");
    if (!className || paramsOpen < 0 || paramsClose < paramsOpen) return undefined;
    const inside = rest.slice(paramsOpen + 1, paramsClose);
    return {
      className,
      returnType: new ClangQualType(returnType),
      parameters: splitParams(inside).map((param) => new ClangQualType(param)),
    };
  }
}

export class ApplySignatureProbe {
  static source(headers: readonly string[], classes: readonly string[]): string {
    const lines = headers.filter((name) => /\.(?:h|hh|hpp|hxx)$/i.test(name)).map((name) => `#include "${name}"`);
    lines.push(
      "",
      "template <class T>",
      "auto take_apply(int) -> decltype(&T::apply) { return &T::apply; }",
      "template <class T>",
      "auto take_apply(...) -> void* { return nullptr; }",
      "template <class T>",
      "auto take_pin(int) -> decltype(&T::connectPin) { return &T::connectPin; }",
      "template <class T>",
      "auto take_pin(...) -> void* { return nullptr; }",
      "",
      "void infer_signatures() {",
    );
    for (const cppClass of classes) {
      const ident = probeIdent(cppClass);
      lines.push(`  auto ${ident}_apply = take_apply<${cppClass}>(0);`);
      lines.push(`  auto ${ident}_pin = take_pin<${cppClass}>(0);`);
    }
    lines.push("}", "");
    return lines.join("\n");
  }

  static read(unit: ClangTranslationUnit, cppClass: string, names?: ClangFunction, pinNames?: ClangFunction): ResolvedApply {
    const ident = probeIdent(cppClass);
    const applyType = unit.varType(`${ident}_apply`);
    const applySpelling = applyType ? memberPointerSpelling(applyType) : undefined;
    if (!applySpelling) {
      throw new Error(`No apply() method on ${cppClass} in clang AST`);
    }
    const parsed = MemberPointerType.parse(applySpelling);
    if (!parsed) throw new Error(`Cannot read apply() type of ${cppClass}: ${applySpelling}`);
    const apply = signatureFromDeclaration(unit, parsed, "apply", names);
    const pinType = unit.varType(`${ident}_pin`);
    const pinSpelling = pinType ? memberPointerSpelling(pinType) : undefined;
    const pinParsed = pinSpelling ? MemberPointerType.parse(pinSpelling) : undefined;
    const connectPin = pinParsed ? signatureFromDeclaration(unit, pinParsed, "connectPin", pinNames) : undefined;
    return connectPin ? { apply, connectPin } : { apply };
  }
}

function memberPointerSpelling(type: ClangQualType): string | undefined {
  const desugared = type.desugaredQualType ?? "";
  if (desugared.includes("::*)")) return desugared;
  if (type.qualType.includes("::*)")) return type.qualType;
  return undefined;
}

function namedFunction(
  name: string,
  returnType: ClangQualType,
  parameters: ClangQualType[],
  source: ClangFunction | undefined,
): ClangFunction {
  const names = parameters.map((_, index) => source?.parameterNames[index] || `arg${index}`);
  return new ClangFunction(name, returnType, parameters, names);
}

// Clang 22 prints a probed member pointer with alias templates canonicalized
// (`Vectorized` as `Array`, `u8` as `unsigned char`). The instantiated method
// declaration still uses the spellings written in the header.
function signatureFromDeclaration(
  unit: ClangTranslationUnit,
  parsed: { className: string; returnType: ClangQualType; parameters: ClangQualType[] },
  name: string,
  source: ClangFunction | undefined,
): ClangFunction {
  const declared = unit.instantiatedMethod(parsed.className, name);
  if (declared && !/^auto\b/.test(declared.returnType.qualType)) return adoptParameterNames(declared, source);
  return namedFunction(name, parsed.returnType, parsed.parameters, source);
}

function adoptParameterNames(declared: ClangFunction, source: ClangFunction | undefined): ClangFunction {
  const parameterNames = declared.parameterNames.map((parameterName, index) => {
    return parameterName || source?.parameterNames[index] || `arg${index}`;
  });
  const renamed = parameterNames.some((parameterName, index) => parameterName !== declared.parameterNames[index]);
  return renamed ? new ClangFunction(declared.name, declared.returnType, declared.parameters, parameterNames) : declared;
}

function classKey(spelling: string): string {
  return spelling.replace(/::/g, ".");
}

function templateArgumentSuffix(node: ClangAstJson): string {
  const parts: string[] = [];
  for (const child of node.inner ?? []) {
    if (child.kind !== "TemplateArgument") continue;
    const spelling = child.type?.qualType;
    if (spelling) parts.push(spelling);
  }
  return parts.length > 0 ? `<${parts.join(", ")}>` : "";
}

function probeIdent(cppClass: string): string {
  const cleaned = cppClass.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `b_${cleaned}`;
}

export class DocElement {
  constructor(
    readonly name: string,
    readonly attributes: Readonly<Record<string, string>>,
    readonly children: readonly DocElement[],
    readonly text: string,
  ) {}

  elements(name: string): DocElement[] {
    return this.children.filter((child) => child.name === name);
  }

  attr(name: string): string | undefined {
    return this.attributes[name];
  }

  toValue(): unknown {
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(this.attributes)) record[key] = coerceAttr(value);
    const groups = new Map<string, DocElement[]>();
    for (const child of this.children) {
      const list = groups.get(child.name) ?? [];
      list.push(child);
      groups.set(child.name, list);
    }
    for (const [name, group] of groups) {
      const values = group.map((child) => child.toValue());
      record[name] = values.length === 1 ? values[0] : values;
    }
    const body = this.text.trim();
    if (body && Object.keys(record).length === 0) return body;
    if (body) record.text = body;
    return record;
  }

  static parse(source: string): DocElement {
    const parser = new DocParser(source.trim());
    const element = parser.element();
    return element;
  }
}

export class DocComment {
  static of(decl: ClangAstJson): DocElement | undefined {
    const comment = ClangComment.of(decl);
    if (!comment) return undefined;
    const text = comment.joinedText().trim();
    if (!text.startsWith("<")) return undefined;
    return DocElement.parse(text);
  }
}

class DocParser {
  private index = 0;

  constructor(private readonly source: string) {}

  element(): DocElement {
    this.skipSpace();
    if (this.source[this.index] !== "<") throw new Error(`Expected an XML tag in clang comment: ${this.source.slice(this.index, this.index + 40)}`);
    this.index += 1;
    const name = this.ident();
    const attributes = this.attributes();
    this.skipSpace();
    if (this.source.startsWith("/>", this.index)) {
      this.index += 2;
      return new DocElement(name, attributes, [], "");
    }
    if (this.source[this.index] !== ">") throw new Error(`Unclosed tag <${name}> in clang comment`);
    this.index += 1;
    const children: DocElement[] = [];
    let text = "";
    while (this.index < this.source.length) {
      if (this.source.startsWith(`</${name}`, this.index)) {
        this.index += name.length + 2;
        this.skipSpace();
        if (this.source[this.index] === ">") this.index += 1;
        break;
      }
      if (this.source[this.index] === "<") {
        children.push(this.element());
        continue;
      }
      const start = this.index;
      while (this.index < this.source.length && this.source[this.index] !== "<") this.index += 1;
      text += this.source.slice(start, this.index);
    }
    return new DocElement(name, attributes, children, text);
  }

  private attributes(): Record<string, string> {
    const attributes: Record<string, string> = {};
    while (this.index < this.source.length) {
      this.skipSpace();
      if (this.source.startsWith("/>", this.index) || this.source[this.index] === ">") break;
      const key = this.ident();
      this.skipSpace();
      if (this.source[this.index] !== "=") throw new Error(`Expected = after attribute ${key}`);
      this.index += 1;
      this.skipSpace();
      const quote = this.source[this.index];
      if (quote !== '"' && quote !== "'") throw new Error(`Expected a quoted attribute value for ${key}`);
      this.index += 1;
      const start = this.index;
      while (this.index < this.source.length && this.source[this.index] !== quote) this.index += 1;
      attributes[key] = this.source.slice(start, this.index);
      if (this.source[this.index] === quote) this.index += 1;
    }
    return attributes;
  }

  private ident(): string {
    const start = this.index;
    while (this.index < this.source.length && /[A-Za-z0-9_:-]/.test(this.source[this.index] ?? "")) this.index += 1;
    const name = this.source.slice(start, this.index);
    if (!name) throw new Error("Expected a name in clang comment XML");
    return name;
  }

  private skipSpace(): void {
    while (this.index < this.source.length && /\s/.test(this.source[this.index] ?? "")) this.index += 1;
  }
}

function coerceAttr(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return value;
}

export class ClangInputFailure {
  constructor(
    readonly inputName: string,
    readonly accepted: string,
    readonly received: string,
  ) {}

  get message(): string {
    const accepted = this.accepted ? ` (${this.accepted})` : "";
    const received = this.received || "the connected value";
    return `input "${this.inputName}"${accepted} cannot accept ${received}`;
  }

  static fromAst(ast: unknown): ClangInputFailure | undefined {
    if (!ast || typeof ast !== "object") return undefined;
    let found: ClangInputFailure | undefined;
    const walk = (node: ClangAstJson): void => {
      if (found) return;
      if (node.kind === "RecoveryExpr") {
        const refs = referencedVars(node);
        const input = refs.find((ref) => ref.name.startsWith("input_"));
        if (input) {
          const received = refs.find((ref) => ref.name !== input.name);
          found = new ClangInputFailure(input.name.slice("input_".length), input.type, received?.type ?? "");
          return;
        }
      }
      for (const child of node.inner ?? []) walk(child);
    };
    walk(ast as ClangAstJson);
    return found;
  }
}

function referencedVars(node: ClangAstJson): { name: string; type: string }[] {
  const found: { name: string; type: string }[] = [];
  const walk = (current: ClangAstJson): void => {
    const decl = current.referencedDecl;
    if (decl?.kind === "VarDecl" && decl.name) {
      found.push({ name: decl.name, type: decl.type?.qualType ?? current.type?.qualType ?? "" });
    }
    for (const child of current.inner ?? []) walk(child);
  };
  walk(node);
  return found;
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
