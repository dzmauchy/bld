/**
 * @title Header Catalog
 *
 * Reads auto-descriptive headers. A comment immediately before a declaration
 * is JSON meta for that type, namespace, block, input, output, or config.
 * Structure and comments come from `clang++ -fsyntax-only -Xclang
 * -ast-dump=json -fparse-all-comments`; config comments inside parameter
 * lists are read from the source at AST offsets because clang does not
 * attach them to parameters.
 */
import type { RawBlockCatalogEntry, RawConfigPropertyCatalogEntry, RawPortCatalogEntry } from "./blockDefinition";
import {
  ClangComment,
  ClangSourceComments,
  JsonComment,
  isMainFileNode,
  type ClangAstJson,
} from "./clangAst";
import { ClangAstDumper } from "./clangAstDumper";
import type { TypeCatalogEntry } from "../types";

export class HeaderCatalog {
  private readonly typeMap: Record<string, TypeCatalogEntry> = {};
  private readonly blockMap: Record<string, RawBlockCatalogEntry> = {};
  private readonly namespaceMap: Record<string, unknown> = {};

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
      catalog.walkFile(dump.ast as ClangAstJson, source, main, []);
    }
    return catalog;
  }

  private walkFile(node: ClangAstJson, source: string, main: string, namespacePath: readonly string[]): void {
    for (const child of node.inner ?? []) this.walk(child, source, main, namespacePath);
  }

  private walk(node: ClangAstJson, source: string, main: string, namespacePath: readonly string[]): void {
    if (node.isImplicit) return;
    if (!isMainFileNode(node, main)) return;
    if (node.kind === "NamespaceDecl") {
      const names = (node.name ?? "").split("::").filter((part) => part.length > 0);
      const comment = ClangComment.of(node)?.asJson();
      if (comment?.kind === "namespace") this.addNamespace([...namespacePath, ...names], comment);
      const next = [...namespacePath, ...names];
      for (const child of node.inner ?? []) this.walk(child, source, main, next);
      return;
    }
    if (node.kind === "CXXRecordDecl") {
      this.readBlock(node, source, namespacePath);
      return;
    }
    if (
      node.kind === "TypeAliasDecl" ||
      node.kind === "TypedefDecl" ||
      node.kind === "TypeAliasTemplateDecl" ||
      node.kind === "ClassTemplateDecl"
    ) {
      this.readType(node);
      return;
    }
    for (const child of node.inner ?? []) this.walk(child, source, main, namespacePath);
  }

  private readType(node: ClangAstJson): void {
    const comment = ClangComment.of(node)?.asJson();
    if (comment?.kind !== "type") return;
    const id = stringField(comment, "id") ?? node.name;
    if (!id) throw new Error("Exposed type comment is missing an id");
    if (this.typeMap[id]) throw new Error(`Duplicate exposed type "${id}"`);
    this.typeMap[id] = typeEntry(comment, id);
  }

  private readBlock(node: ClangAstJson, source: string, namespacePath: readonly string[]): void {
    const comment = ClangComment.of(node)?.asJson();
    if (comment?.kind !== "block") return;
    const className = node.name;
    if (!className) throw new Error("Exposed block is missing a class name");
    const id = stringField(comment, "id") ?? className;
    if (this.blockMap[id]) throw new Error(`Duplicate exposed block "${id}"`);
    const ns = stringList(comment.value.ns) ?? [...namespacePath];
    const inputs: Record<string, RawPortCatalogEntry> = {};
    const outputs: Record<string, RawPortCatalogEntry> = {};
    const conf: Record<string, RawConfigPropertyCatalogEntry> = {};
    for (const child of node.inner ?? []) {
      if (child.isImplicit) continue;
      if (child.kind === "TypeAliasDecl" || child.kind === "TypedefDecl") this.readPort(child, inputs, outputs);
      if (child.kind === "CXXConstructorDecl" || child.kind === "CXXMethodDecl") this.readConf(child, source, conf);
    }
    const raw: RawBlockCatalogEntry = {
      ns,
      title: stringField(comment, "title") ?? id,
      description: stringField(comment, "description") ?? "",
      icon: stringField(comment, "icon") ?? "",
      cpp: [...namespacePath, className].join("::"),
    };
    if (Object.keys(inputs).length > 0) raw.inputs = inputs;
    if (Object.keys(outputs).length > 0) raw.outputs = outputs;
    if (Object.keys(conf).length > 0) raw.conf = conf;
    const implementation = stringList(comment.value.implementation);
    if (implementation) raw.implementation = implementation;
    this.blockMap[id] = raw;
  }

  private readPort(
    node: ClangAstJson,
    inputs: Record<string, RawPortCatalogEntry>,
    outputs: Record<string, RawPortCatalogEntry>,
  ): void {
    const comment = ClangComment.of(node)?.asJson();
    if (comment?.kind !== "input" && comment?.kind !== "output") return;
    const id = stringField(comment, "id") ?? node.name;
    if (!id) throw new Error("Exposed port comment is missing an id");
    const port: RawPortCatalogEntry = {
      vector: Boolean(comment.value.vector),
      type: comment.value.type as RawPortCatalogEntry["type"],
    };
    if (comment.value.concept !== undefined) port.concept = comment.value.concept;
    (comment.kind === "input" ? inputs : outputs)[id] = port;
  }

  private readConf(node: ClangAstJson, source: string, conf: Record<string, RawConfigPropertyCatalogEntry>): void {
    for (const param of node.inner ?? []) {
      if (param.kind !== "ParmVarDecl") continue;
      const begin = ClangSourceComments.declBeginOffset(param);
      if (begin === undefined) continue;
      const comment = ClangSourceComments.precedingBlockJson(source, begin);
      if (comment?.kind !== "conf") continue;
      const id = stringField(comment, "id") ?? param.name;
      if (!id) throw new Error("Exposed config comment is missing an id");
      if (conf[id]) throw new Error(`Duplicate config "${id}"`);
      const entry: RawConfigPropertyCatalogEntry = {
        type: comment.value.type as RawConfigPropertyCatalogEntry["type"],
      };
      if (comment.value.control && typeof comment.value.control === "object" && !Array.isArray(comment.value.control)) {
        const control = comment.value.control as Record<string, unknown> & { default?: unknown };
        entry.control = control;
      }
      conf[id] = entry;
    }
  }

  private addNamespace(path: readonly string[], comment: JsonComment): void {
    if (path.length === 0) return;
    let cursor = this.namespaceMap;
    for (let index = 0; index < path.length; index += 1) {
      const key = path[index] ?? "";
      const existing = cursor[key] as { children?: Record<string, unknown> } | undefined;
      if (index === path.length - 1) {
        const node: Record<string, unknown> = {
          name: stringField(comment, "name") ?? key,
        };
        const icon = stringField(comment, "icon");
        const description = stringField(comment, "description");
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

function typeEntry(comment: JsonComment, id: string): TypeCatalogEntry {
  const entry: TypeCatalogEntry = { name: stringField(comment, "name") ?? id };
  const description = stringField(comment, "description");
  if (description) entry.description = description;
  const compatible = stringList(comment.value.as_arg_compatible_with);
  if (compatible) entry.as_arg_compatible_with = compatible;
  const params = comment.value.params;
  if (params && typeof params === "object" && !Array.isArray(params)) {
    const parsed = params as Record<string, { name: string; description?: string }>;
    entry.params = parsed;
  }
  return entry;
}

function stringField(comment: JsonComment, key: string): string | undefined {
  const value = comment.value[key];
  return typeof value === "string" ? value : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
  return value;
}
