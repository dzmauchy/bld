/**
 * @title C++ Syntax
 *
 * Tree-sitter C++ front end. Header and diagram comments are read from this
 * tree instead of a hand-written scanner.
 */
import { cppParserAssets } from "#parser-assets";
import Parser from "web-tree-sitter";

export class JsonComment {
  private constructor(readonly value: Record<string, unknown>) {}

  static fromText(text: string): JsonComment | undefined {
    let body = text.trim();
    if (body.startsWith("/*")) body = body.slice(2);
    else if (body.startsWith("//")) body = body.slice(2);
    else return undefined;
    if (body.endsWith("*/")) body = body.slice(0, -2);
    body = body.trim();
    if (!body.startsWith("{")) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
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

  static before(node: CppNode): JsonComment | undefined {
    let sibling = node.previousSibling;
    while (sibling) {
      if (sibling.type === "comment") return JsonComment.fromText(sibling.text);
      if (sibling.isNamed) return undefined;
      sibling = sibling.previousSibling;
    }
    return undefined;
  }
}

export class CppNode {
  constructor(private readonly node: Parser.SyntaxNode) {}

  get type(): string {
    return this.node.type;
  }

  get text(): string {
    return this.node.text;
  }

  get isNamed(): boolean {
    return this.node.isNamed;
  }

  get namedChildren(): CppNode[] {
    return this.node.namedChildren.map((child) => new CppNode(child));
  }

  get previousSibling(): CppNode | null {
    return this.node.previousSibling ? new CppNode(this.node.previousSibling) : null;
  }

  field(name: string): CppNode | null {
    const child = this.node.childForFieldName(name);
    return child ? new CppNode(child) : null;
  }

  childOfType(type: string): CppNode | undefined {
    return this.namedChildren.find((child) => child.type === type);
  }

  descendants(type: string): CppNode[] {
    const found: CppNode[] = [];
    const walk = (node: CppNode): void => {
      if (node.type === type) found.push(node);
      for (const child of node.namedChildren) walk(child);
    };
    walk(this);
    return found;
  }
}

export class CppSyntaxTree {
  constructor(
    private readonly rootNode: CppNode,
    private readonly tree: Parser.Tree,
  ) {
    void this.tree;
  }

  get root(): CppNode {
    return this.rootNode;
  }

  diagramMeta(): Record<string, unknown> | undefined {
    const lineRun: string[] = [];
    const flushLines = (): Record<string, unknown> | undefined => {
      if (lineRun.length === 0) return undefined;
      const parsed = JsonComment.fromText(`// ${lineRun.join("\n")}`);
      lineRun.length = 0;
      return parsed && isDiagramMeta(parsed.value) ? parsed.value : undefined;
    };
    for (const comment of this.root.descendants("comment")) {
      const text = comment.text.trim();
      if (text.startsWith("//")) {
        lineRun.push(text.replace(/^\/\/\s?/, ""));
        continue;
      }
      const fromLines = flushLines();
      if (fromLines) return fromLines;
      const parsed = JsonComment.fromText(text);
      if (parsed && isDiagramMeta(parsed.value)) return parsed.value;
    }
    return flushLines();
  }

  hasFunction(name: string): boolean {
    return this.root.descendants("function_definition").some((fn) => {
      const declarator = fn.childOfType("function_declarator");
      return declarator?.namedChildren.some((child) => child.type === "identifier" && child.text === name) ?? false;
    });
  }
}

function isDiagramMeta(value: Record<string, unknown>): boolean {
  return Boolean(value.blocks && typeof value.blocks === "object" && value.connections && typeof value.connections === "object");
}

export abstract class CppSyntax {
  abstract parse(source: string): CppSyntaxTree;
}

export class TreeSitterCppSyntax extends CppSyntax {
  private static ready: Promise<TreeSitterCppSyntax> | undefined;

  private constructor(private readonly parser: Parser) {
    super();
  }

  static create(): Promise<TreeSitterCppSyntax> {
    if (!this.ready) {
      this.ready = this.load().catch((error: unknown) => {
        this.ready = undefined;
        throw error;
      });
    }
    return this.ready;
  }

  override parse(source: string): CppSyntaxTree {
    const tree = this.parser.parse(source);
    return new CppSyntaxTree(new CppNode(tree.rootNode), tree);
  }

  private static async load(): Promise<TreeSitterCppSyntax> {
    await Parser.init(cppParserAssets.initOptions());
    const language = await Parser.Language.load(await cppParserAssets.language());
    const parser = new Parser();
    parser.setLanguage(language);
    return new TreeSitterCppSyntax(parser);
  }
}
