import { isMainFileNode, type ClangAstJson } from "./clangAst.ts";

/** Reads main-file declarations without materializing the much larger included-header AST. */
export class ClangAstReader {
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private inDeclarations = false;
  private header = "";
  private node = "";
  private selected: boolean | undefined;
  private readonly declarations: ClangAstJson[] = [];
  private complete = false;

  constructor(private readonly mainFile: string) {}

  read(chunk: Uint8Array): void {
    // Clang writes UTF-8; decoding whole chunks can split a multibyte character.
    this.scan(this.decoder.decode(chunk, { stream: true }));
  }

  finish(): ClangAstJson {
    this.scan(this.decoder.decode());
    if (!this.complete || this.depth !== 0 || this.quoted) throw new Error("Incomplete Clang JSON AST");
    return { kind: "TranslationUnitDecl", inner: this.declarations };
  }

  private readonly decoder = new TextDecoder();

  private scan(text: string): void {
    let start = 0;
    for (let index = 0; index < text.length; index++) {
      const char = text[index]!;
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (char === "\\") this.escaped = true;
        else if (char === '"') this.quoted = false;
        continue;
      }
      if (char === '"') { this.quoted = true; continue; }
      if (char === "{" || char === "[") {
        if (!this.inDeclarations && this.depth === 1 && char === "[") {
          this.header += text.slice(start, index);
          if (!/"inner"\s*:\s*$/.test(this.header)) throw new Error("Expected Clang AST declarations");
          this.inDeclarations = true;
          start = index + 1;
        } else if (this.inDeclarations && this.depth === 2 && char === "{") {
          this.node = "";
          this.selected = undefined;
          start = index;
        } else if (this.inDeclarations && this.depth === 3 && char === "[" && this.selected === undefined) {
          this.node += text.slice(start, index);
          if (/"inner"\s*:\s*$/.test(this.node)) {
            const header = JSON.parse(this.node.replace(/,?\s*"inner"\s*:\s*$/, "") + "}") as ClangAstJson;
            this.selected = isMainFileNode(header, this.mainFile);
          }
          start = index;
        }
        this.depth++;
      } else if (char === "}" || char === "]") {
        this.depth--;
        if (this.inDeclarations && this.depth === 2 && char === "}") {
          if (this.selected !== false) {
            this.node += text.slice(start, index + 1);
            const node = JSON.parse(this.node) as ClangAstJson;
            if (isMainFileNode(node, this.mainFile)) this.declarations.push(node);
          }
          this.node = "";
          this.selected = false;
          start = index + 1;
        } else if (this.depth === 0) {
          this.complete = true;
          start = index + 1;
        }
      }
    }
    if (!this.inDeclarations) this.header += text.slice(start);
    else if (this.depth >= 3 && this.selected !== false) this.node += text.slice(start);
  }
}
