/**
 * @title Header Catalog
 *
 * Reads auto-descriptive headers. A comment immediately before a declaration
 * is JSON meta for that type, namespace, block, input, output, or config.
 */
import type { RawBlockCatalogEntry, RawConfigPropertyCatalogEntry, RawPortCatalogEntry } from "./blockDefinition";
import { CppSyntax, JsonComment, type CppNode } from "./cppSyntax";
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

  static parse(sources: readonly string[], syntax: CppSyntax): HeaderCatalog {
    const catalog = new HeaderCatalog();
    for (const source of sources) catalog.walk(syntax.parse(source).root, []);
    return catalog;
  }

  private walk(node: CppNode, namespacePath: readonly string[]): void {
    if (node.type === "namespace_definition") {
      const names = namespaceNames(node);
      const comment = JsonComment.before(node);
      if (comment?.kind === "namespace") this.addNamespace([...namespacePath, ...names], comment);
      const body = node.childOfType("declaration_list");
      const next = [...namespacePath, ...names];
      for (const child of body?.namedChildren ?? []) this.walk(child, next);
      return;
    }
    if (node.type === "class_specifier") {
      this.readBlock(node, namespacePath);
      return;
    }
    if (node.type === "alias_declaration" || node.type === "template_declaration") this.readType(node);
    for (const child of node.namedChildren) this.walk(child, namespacePath);
  }

  private readType(node: CppNode): void {
    const comment = JsonComment.before(node);
    if (comment?.kind !== "type") return;
    const id = stringField(comment, "id") ?? declaratorName(node);
    if (!id) throw new Error("Exposed type comment is missing an id");
    if (this.typeMap[id]) throw new Error(`Duplicate exposed type "${id}"`);
    this.typeMap[id] = typeEntry(comment, id);
  }

  private readBlock(node: CppNode, namespacePath: readonly string[]): void {
    const comment = JsonComment.before(node);
    if (comment?.kind !== "block") return;
    const className = node.field("name")?.text ?? node.childOfType("type_identifier")?.text;
    if (!className) throw new Error("Exposed block is missing a class name");
    const id = stringField(comment, "id") ?? className;
    if (this.blockMap[id]) throw new Error(`Duplicate exposed block "${id}"`);
    const ns = stringList(comment.value.ns) ?? [...namespacePath];
    const body = node.childOfType("field_declaration_list");
    const inputs: Record<string, RawPortCatalogEntry> = {};
    const outputs: Record<string, RawPortCatalogEntry> = {};
    const conf: Record<string, RawConfigPropertyCatalogEntry> = {};
    for (const child of body?.namedChildren ?? []) {
      if (child.type === "alias_declaration") this.readPort(child, inputs, outputs);
      if (child.type === "function_definition") this.readConf(child, conf);
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
    node: CppNode,
    inputs: Record<string, RawPortCatalogEntry>,
    outputs: Record<string, RawPortCatalogEntry>,
  ): void {
    const comment = JsonComment.before(node);
    if (comment?.kind !== "input" && comment?.kind !== "output") return;
    const id = stringField(comment, "id") ?? node.childOfType("type_identifier")?.text;
    if (!id) throw new Error("Exposed port comment is missing an id");
    const port: RawPortCatalogEntry = {
      vector: Boolean(comment.value.vector),
      type: comment.value.type as RawPortCatalogEntry["type"],
    };
    if (comment.value.concept !== undefined) port.concept = comment.value.concept;
    (comment.kind === "input" ? inputs : outputs)[id] = port;
  }

  private readConf(node: CppNode, conf: Record<string, RawConfigPropertyCatalogEntry>): void {
    const list = node.childOfType("function_declarator")?.childOfType("parameter_list");
    for (const param of list?.namedChildren ?? []) {
      if (param.type !== "parameter_declaration" && param.type !== "optional_parameter_declaration") continue;
      const comment = JsonComment.before(param);
      if (comment?.kind !== "conf") continue;
      const id = stringField(comment, "id") ?? param.childOfType("identifier")?.text;
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

function namespaceNames(node: CppNode): string[] {
  const name = node.field("name");
  if (!name) return [];
  if (name.type === "nested_namespace_specifier") {
    return name.namedChildren.map((child) => child.text).filter((part) => part.length > 0 && part !== "::");
  }
  return name.text.split("::").filter((part) => part.length > 0);
}

function declaratorName(node: CppNode): string | undefined {
  if (node.type === "alias_declaration") return node.childOfType("type_identifier")?.text;
  if (node.type === "template_declaration") {
    const inner = node.childOfType("alias_declaration") ?? node.childOfType("class_specifier");
    if (!inner) return undefined;
    if (inner.type === "alias_declaration") return inner.childOfType("type_identifier")?.text;
    return inner.field("name")?.text ?? inner.childOfType("type_identifier")?.text;
  }
  return node.field("name")?.text;
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
