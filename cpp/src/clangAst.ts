/**
 * @title Clang AST Types
 *
 * Consumes `clang++ -Xclang -ast-dump=json -fparse-all-comments` output to
 * recover C++ types, detect incompatibilities, and read JSON comments.
 * No custom unification or port-type algebra, and no separate C++ parser.
 */

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
    return /\bVectorized(?:Input|Output)?\s*</.test(this.qualType)
      || /\bVectorized(?:Input|Output)?\s*</.test(this.canonical)
      || /\b(?:span|vector)\s*</.test(this.canonical);
  }

  get isPointer(): boolean {
    return this.qualType.includes("*");
  }

}

/** Named auto declarations are enough to recover diagram port types. */
export class ClangTranslationUnit {
  private constructor(private readonly variables: ReadonlyMap<string, ClangQualType>) {}

  static parse(ast: unknown): ClangTranslationUnit {
    const variables = new Map<string, ClangQualType>();
    const walk = (node: ClangAstJson): void => {
      if (node.kind === "VarDecl" && node.name) variables.set(node.name, ClangQualType.fromAst(node.type));
      node.inner?.forEach(walk);
    };
    walk(ast as ClangAstJson);
    return new ClangTranslationUnit(variables);
  }

  varType(name: string): ClangQualType | undefined {
    return this.variables.get(name);
  }
}
