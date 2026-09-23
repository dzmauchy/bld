/**
 * Reads block, type, and namespace JSON comments from library headers.
 * Browser palette enumeration uses these comments directly so the block list
 * matches the library without a host clang++ process.
 */
import type { RawBlockCatalogEntry } from "core";
import type { TypeCatalogEntry } from "core";

class JsonBlockComment {
  private constructor(private readonly value: Record<string, unknown>) {}

  static readAll(source: string): JsonBlockComment[] {
    const comments: JsonBlockComment[] = [];
    let cursor = 0;
    while (cursor < source.length) {
      const start = source.indexOf("/*", cursor);
      if (start < 0) break;
      const end = source.indexOf("*/", start + 2);
      if (end < 0) break;
      const body = source.slice(start + 2, end).trim();
      if (body.startsWith("{")) {
        try {
          const parsed: unknown = JSON.parse(body);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            comments.push(new JsonBlockComment(parsed as Record<string, unknown>));
          }
        } catch {
          // Non-JSON block comments are not catalog entries.
        }
      }
      cursor = end + 2;
    }
    return comments;
  }

  get kind(): string | undefined {
    return this.string("kind");
  }

  string(key: string): string | undefined {
    const value = this.value[key];
    return typeof value === "string" ? value : undefined;
  }

  stringList(key: string): string[] | undefined {
    const value = this.value[key];
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return undefined;
    return value;
  }

  params(): NonNullable<TypeCatalogEntry["params"]> | undefined {
    const value = this.value.params;
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const params: NonNullable<TypeCatalogEntry["params"]> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
      const record = raw as Record<string, unknown>;
      if (typeof record.name !== "string") return undefined;
      const param: { name: string; description?: string } = { name: record.name };
      if (typeof record.description === "string") param.description = record.description;
      params[key] = param;
    }
    return params;
  }
}

export class HeaderCommentCatalog {
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

  static fromSources(sources: Iterable<string>): HeaderCommentCatalog {
    const catalog = new HeaderCommentCatalog();
    for (const source of sources) catalog.read(source);
    return catalog;
  }

  private read(source: string): void {
    for (const comment of JsonBlockComment.readAll(source)) {
      if (comment.kind === "type") this.readType(comment);
      else if (comment.kind === "block") this.readBlock(comment);
      else if (comment.kind === "namespace") this.readNamespace(comment);
    }
  }

  private readType(comment: JsonBlockComment): void {
    const id = comment.string("id");
    if (!id || this.typeMap[id]) return;
    const entry: TypeCatalogEntry = { name: comment.string("name") ?? id };
    const description = comment.string("description");
    if (description) entry.description = description;
    const compatible = comment.stringList("as_arg_compatible_with");
    if (compatible) entry.as_arg_compatible_with = compatible;
    const params = comment.params();
    if (params) entry.params = params;
    this.typeMap[id] = entry;
  }

  private readBlock(comment: JsonBlockComment): void {
    const id = comment.string("id");
    if (!id || this.blockMap[id]) return;
    const raw: RawBlockCatalogEntry = {
      ns: comment.stringList("ns") ?? [],
      title: comment.string("title") ?? id,
      description: comment.string("description") ?? "",
      icon: comment.string("icon") ?? "",
    };
    const implementation = comment.stringList("implementation");
    if (implementation) raw.implementation = implementation;
    this.blockMap[id] = raw;
  }

  private readNamespace(comment: JsonBlockComment): void {
    const name = comment.string("name");
    if (!name || this.namespaceMap[name]) return;
    const node: Record<string, unknown> = { name };
    const icon = comment.string("icon");
    const description = comment.string("description");
    if (icon) node.icon = icon;
    if (description) node.description = description;
    this.namespaceMap[name] = node;
  }
}
