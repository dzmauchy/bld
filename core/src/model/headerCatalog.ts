/**
 * @title Header Catalog
 *
 * Reads auto-descriptive headers. A javadoc comment immediately before a
 * declaration is XML meta for that type, namespace, or block. Clang attaches
 * those comments without `-fparse-all-comments`.
 *
 * Blocks are classes that extend `Block` and carry a `<block>` comment.
 * The namespace is the C++ namespace of the class. `<input>` elements pair
 * with stream parameters of `apply` (or `connectPin` when `apply` has none).
 * `<output>` elements pair with the return value. `Vectorized<...>` marks a
 * vector port. Concrete types come from a signature probe: `auto` variables
 * hold `&Class::apply`, and the dumped AST has the resolved types.
 */
import type { RawBlockCatalogEntry, RawConfigPropertyCatalogEntry, RawPortCatalogEntry } from "./blockDefinition";
import {
  ApplySignatureProbe,
  ClangAstDumper,
  ClangFunction,
  ClangTranslationUnit,
  DocComment,
  DocElement,
  isMainFileNode,
  type ClangAstJson,
  type ResolvedApply,
} from "cpp";
import type { TypeCatalogEntry } from "../types";

type CommentPort = {
  icon: string;
  description: string;
  concept?: unknown;
};

type PendingBlock = {
  id: string;
  cpp: string;
  inputs: CommentPort[];
  outputs: CommentPort[];
  apply?: ClangFunction;
  connectPin?: ClangFunction;
};

class InheritanceIndex {
  private readonly basesOf = new Map<string, string[]>();
  private readonly bySimple = new Map<string, string[]>();

  add(qualified: string, simple: string, bases: string[]): void {
    const existing = this.basesOf.get(qualified);
    if (!existing || bases.length > 0) this.basesOf.set(qualified, bases);
    const named = this.bySimple.get(simple) ?? [];
    if (!named.includes(qualified)) named.push(qualified);
    this.bySimple.set(simple, named);
  }

  extendsBlock(name: string, seen = new Set<string>()): boolean {
    const simple = name.split(".").pop() ?? name;
    if (simple === "Block") return true;
    if (seen.has(name)) return false;
    seen.add(name);
    const candidates = new Set<string>([name, ...(this.bySimple.get(simple) ?? [])]);
    for (const candidate of candidates) {
      for (const base of this.basesOf.get(candidate) ?? []) {
        if (this.extendsBlock(base, seen)) return true;
      }
    }
    return false;
  }

  static fromAst(ast: ClangAstJson): InheritanceIndex {
    const index = new InheritanceIndex();
    const walk = (node: ClangAstJson, namespace: string[]): void => {
      if (node.isImplicit) return;
      if (node.kind === "NamespaceDecl") {
        const names = (node.name ?? "").split("::").filter((part) => part.length > 0);
        const next = [...namespace, ...names];
        for (const child of node.inner ?? []) walk(child, next);
        return;
      }
      if (node.kind === "CXXRecordDecl" && node.name) {
        const bases = (node.bases ?? []).map(baseRecordName).filter(Boolean);
        index.add([...namespace, node.name].join("."), node.name, bases);
        const next = [...namespace, node.name];
        for (const child of node.inner ?? []) walk(child, next);
        return;
      }
      for (const child of node.inner ?? []) walk(child, namespace);
    };
    walk(ast, []);
    return index;
  }
}

function baseRecordName(base: { type?: { qualType?: string; desugaredQualType?: string } }): string {
  const raw = base.type?.desugaredQualType || base.type?.qualType || "";
  const head = raw.split("<")[0] ?? "";
  return head.replace(/::/g, ".").replace(/\s+/g, "").trim();
}

export class HeaderCatalog {
  private readonly typeMap: Record<string, TypeCatalogEntry> = {};
  private readonly blockMap: Record<string, RawBlockCatalogEntry> = {};
  private readonly namespaceMap: Record<string, unknown> = {};
  private readonly pending: PendingBlock[] = [];
  readonly signatures = new Map<string, ResolvedApply>();

  private constructor() {}

  get types(): Record<string, TypeCatalogEntry> {
    return this.typeMap;
  }

  get blocks(): Record<string, RawBlockCatalogEntry> {
    return this.blockMap;
  }

  get namespaces(): Record<string, unknown> {
    return this.namespaceMap;
  }

  static async parse(
    files: Record<string, string> | Map<string, string>,
    mains: readonly string[],
    dumper: ClangAstDumper = ClangAstDumper.defaultDumper(),
  ): Promise<HeaderCatalog> {
    const catalog = new HeaderCatalog();
    const fileMap = files instanceof Map ? files : new Map(Object.entries(files));
    for (const main of mains) {
      const source = fileMap.get(main);
      if (source === undefined) throw new Error(`HeaderCatalog is missing file "${main}"`);
      const dump = await dumper.dumpAsync(new Map(fileMap), main);
      if (!dump.ok || dump.ast === undefined) {
        throw new Error(`clang++ AST dump of "${main}" failed\n${dump.diagnostics}`);
      }
      const ast = dump.ast as ClangAstJson;
      const index = InheritanceIndex.fromAst(ast);
      const unit = ClangTranslationUnit.parse(ast);
      catalog.walkFile(ast, main, [], index, unit);
    }
    await catalog.assignPortTypes(fileMap, dumper);
    return catalog;
  }

  private walkFile(
    node: ClangAstJson,
    main: string,
    namespacePath: readonly string[],
    index: InheritanceIndex,
    unit: ClangTranslationUnit,
  ): void {
    for (const child of node.inner ?? []) this.walk(child, main, namespacePath, index, unit);
  }

  private walk(
    node: ClangAstJson,
    main: string,
    namespacePath: readonly string[],
    index: InheritanceIndex,
    unit: ClangTranslationUnit,
  ): void {
    if (node.isImplicit) return;
    if (node.kind === "NamespaceDecl") {
      const names = (node.name ?? "").split("::").filter((part) => part.length > 0);
      const next = [...namespacePath, ...names];
      if (isMainFileNode(node, main)) {
        const comment = DocComment.of(node);
        if (comment?.name === "namespace") this.addNamespace(next, comment);
      }
      for (const child of node.inner ?? []) this.walk(child, main, next, index, unit);
      return;
    }
    if (!isMainFileNode(node, main)) return;
    if (node.kind === "CXXRecordDecl") {
      this.readBlock(node, namespacePath, index, unit);
      return;
    }
    if (
      node.kind === "TypeAliasDecl" ||
      node.kind === "TypedefDecl" ||
      node.kind === "TypeAliasTemplateDecl" ||
      node.kind === "ClassTemplateDecl"
    ) {
      this.readType(node);
    }
  }

  private readType(node: ClangAstJson): void {
    const comment = DocComment.of(node);
    if (comment?.name !== "type") return;
    const id = node.name;
    if (!id) throw new Error("Exposed type comment is missing a declared name");
    if (this.typeMap[id]) return;
    const entry: TypeCatalogEntry = { name: comment.attr("name") ?? id };
    const description = comment.attr("description");
    if (description) entry.description = description;
    const args = comment.elements("arg");
    if (args.length > 0) {
      entry.params = Object.fromEntries(args.map((arg) => {
        const param = arg.attr("name") ?? "T";
        const paramDescription = arg.attr("description");
        return [param, paramDescription ? { name: param, description: paramDescription } : { name: param }];
      }));
    }
    this.typeMap[id] = entry;
  }

  private readBlock(
    node: ClangAstJson,
    namespacePath: readonly string[],
    index: InheritanceIndex,
    unit: ClangTranslationUnit,
  ): void {
    const comment = DocComment.of(node);
    if (comment?.name !== "block") return;
    const className = node.name;
    if (!className) throw new Error("Exposed block is missing a class name");
    const qualified = [...namespacePath, className].join(".");
    if (!index.extendsBlock(qualified) && !index.extendsBlock(className)) return;
    const id = blockIdFromClass(className);
    if (this.pending.some((block) => block.id === id)) throw new Error(`Duplicate exposed block "${id}"`);
    const cpp = [...namespacePath, className].join("::");
    const raw: RawBlockCatalogEntry = {
      ns: [...namespacePath],
      title: comment.attr("title") ?? id,
      description: comment.attr("description") ?? "",
      icon: comment.attr("icon") ?? "",
      cpp,
    };
    const conf = readConf(comment);
    if (Object.keys(conf).length > 0) raw.conf = conf;
    const implementation = comment.elements("implementation").map((element) => element.text.trim()).filter(Boolean);
    if (implementation.length > 0) raw.implementation = implementation;
    this.blockMap[id] = raw;
    const pending: PendingBlock = {
      id,
      cpp,
      inputs: comment.elements("input").map(readCommentPort),
      outputs: comment.elements("output").map(readCommentPort),
    };
    const apply = unit.resolveMethod(cpp, "apply");
    const connectPin = unit.resolveMethod(cpp, "connectPin");
    if (apply) pending.apply = apply;
    if (connectPin) pending.connectPin = connectPin;
    this.pending.push(pending);
  }

  private async assignPortTypes(files: Map<string, string>, dumper: ClangAstDumper): Promise<void> {
    if (this.pending.length === 0) return;
    const classes = this.pending.map((block) => block.cpp);
    const headers = signatureProbeHeaders(files);
    const probeFiles = new Map(files);
    probeFiles.set("probe.cpp", ApplySignatureProbe.source(headers, classes));
    const dump = await dumper.dumpAsync(probeFiles, "probe.cpp");
    if (dump.ast === undefined) {
      throw new Error(`clang++ AST dump of block signatures failed\n${dump.diagnostics}`);
    }
    const unit = ClangTranslationUnit.parse(dump.ast);
    for (const block of this.pending) {
      const signature = ApplySignatureProbe.read(unit, block.cpp, block.apply, block.connectPin);
      this.signatures.set(block.cpp, signature);
      const raw = this.blockMap[block.id];
      if (!raw) continue;
      const fromApply = signature.apply.streamParameters();
      const streamParams = fromApply.length > 0 ? fromApply : signature.connectPin?.streamParameters() ?? [];
      if (streamParams.length !== block.inputs.length) {
        throw new Error(
          `${block.cpp} has ${block.inputs.length} <input> comments and ${streamParams.length} stream parameters`,
        );
      }
      if (block.outputs.length > 1) {
        throw new Error(`${block.cpp} has ${block.outputs.length} <output> comments; apply returns one value`);
      }
      if (block.outputs.length === 1 && signature.apply.returnType.isVoid) {
        throw new Error(`${block.cpp} documents an output but apply() returns void`);
      }
      const inputs: Record<string, RawPortCatalogEntry> = {};
      streamParams.forEach((param, index) => {
        const meta = block.inputs[index];
        if (!meta) return;
        const port: RawPortCatalogEntry = {
          vector: param.type.isVectorized,
          type: param.type.qualType,
          icon: meta.icon,
          description: meta.description,
        };
        if (meta.concept !== undefined) port.concept = meta.concept;
        inputs[param.name] = port;
      });
      if (Object.keys(inputs).length > 0) raw.inputs = inputs;
      const output = block.outputs[0];
      if (output && !signature.apply.returnType.isVoid) {
        raw.outputs = {
          out: {
            vector: signature.apply.returnType.isVectorized,
            type: signature.apply.returnType.qualType,
            icon: output.icon,
            description: output.description,
          },
        };
      }
    }
  }

  private addNamespace(path: readonly string[], comment: DocElement): void {
    if (path.length === 0) return;
    let cursor = this.namespaceMap;
    for (let index = 0; index < path.length; index += 1) {
      const key = path[index] ?? "";
      const existing = cursor[key] as { children?: Record<string, unknown> } | undefined;
      if (index === path.length - 1) {
        const description = comment.attr("description");
        const node: Record<string, unknown> = { name: description || key };
        const icon = comment.attr("icon");
        if (icon) node.icon = icon;
        if (description) node.description = description;
        if (existing?.children) node.children = existing.children;
        cursor[key] = node;
        return;
      }
      if (!existing) cursor[key] = { name: key, children: {} };
      const parent = cursor[key] as { children?: Record<string, unknown> };
      parent.children ??= {};
      cursor = parent.children;
    }
  }
}

export function blockIdFromClass(className: string): string {
  return className
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function signatureProbeHeaders(files: Map<string, string>): string[] {
  const headers = [...files.keys()].filter((name) => /\.(?:h|hh|hpp|hxx)$/i.test(name));
  const library = headers.filter((name) => !/^(?:browser|mcu)\//.test(name));
  if (library.includes("base.hpp")) {
    const bundled = new Set(
      library.filter((name) => name === "base.hpp" || name.startsWith("base/") || name.startsWith("core/")),
    );
    return ["base.hpp", ...library.filter((name) => !bundled.has(name))];
  }
  return library;
}

function readCommentPort(element: DocElement): CommentPort {
  const concept = element.elements("concept")[0];
  const port: CommentPort = {
    icon: element.attr("icon") ?? "",
    description: element.attr("description") ?? "",
  };
  if (concept) port.concept = concept.toValue();
  return port;
}

function readConf(block: DocElement): Record<string, RawConfigPropertyCatalogEntry> {
  const conf: Record<string, RawConfigPropertyCatalogEntry> = {};
  for (const element of block.elements("conf")) {
    const id = element.attr("id");
    const type = element.attr("type");
    if (!id || !type) throw new Error("Exposed config comment is missing an id or type");
    if (conf[id]) throw new Error(`Duplicate config "${id}"`);
    const entry: RawConfigPropertyCatalogEntry = { type };
    const control = element.elements("control")[0];
    if (control) {
      const value = control.toValue();
      if (value && typeof value === "object" && !Array.isArray(value)) {
        entry.control = value as Record<string, unknown> & { default?: unknown };
      }
    }
    conf[id] = entry;
  }
  return conf;
}
