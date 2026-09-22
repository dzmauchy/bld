/**
 * Removes the diagram's JSON metadata comment before in-browser clang sees it.
 * The comment stays in the original diagram source that core parses. An inert
 * declaration then snaps the file to a source size this clang accepts for
 * wasm32-unknown-emscripten.
 */
export class DiagramMetaCommentFilter {
  // wasm32-unknown-emscripten clang aborts on some source sizes. After the
  // diagram comment is removed, snap the file to the next size that frontend accepts.
  private static readonly safeSourceSizes = [1400, 2400, 3600, 4800];

  apply(source: string): string {
    const normalized = this.stripLineRuns(this.stripBlockComments(source));
    if (normalized === source) return source;
    return this.addShortSourcePreamble(normalized);
  }

  private stripBlockComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
      const body = comment.slice(2, -2).trim();
      return this.isDiagramMeta(body) ? "" : comment;
    });
  }

  private stripLineRuns(source: string): string {
    const lines = source.split("\n");
    const kept: string[] = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index] ?? "";
      if (!this.isLineComment(line)) {
        kept.push(line);
        index += 1;
        continue;
      }
      let end = index;
      const parts: string[] = [];
      while (end < lines.length && this.isLineComment(lines[end] ?? "")) {
        parts.push(this.lineBody(lines[end] ?? ""));
        end += 1;
      }
      if (this.isDiagramMeta(parts.join("\n").trim())) {
        index = end;
        continue;
      }
      for (let cursor = index; cursor < end; cursor += 1) kept.push(lines[cursor] ?? "");
      index = end;
    }
    return kept.join("\n");
  }

  private addShortSourcePreamble(source: string): string {
    const byteLength = new TextEncoder().encode(source).byteLength;
    const mountOffset = source.indexOf('extern "C" void mount()');
    if (mountOffset < 0) return source;
    const prefix = 'static constexpr char bld_clang_source_padding[] = "';
    const suffix = '";\n';
    for (const target of DiagramMetaCommentFilter.safeSourceSizes) {
      const payloadBytes = target - byteLength - prefix.length - suffix.length;
      if (payloadBytes < 1) continue;
      const declaration = `${prefix}${"x".repeat(payloadBytes)}${suffix}`;
      return `${source.slice(0, mountOffset)}${declaration}${source.slice(mountOffset)}`;
    }
    return source;
  }

  private isLineComment(line: string): boolean {
    return line.trimStart().startsWith("//");
  }

  private lineBody(line: string): string {
    return line.trimStart().replace(/^\/\/\s?/, "");
  }

  private isDiagramMeta(body: string): boolean {
    if (!body.startsWith("{")) return false;
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
      const record = parsed as Record<string, unknown>;
      return Boolean(
        record.blocks && typeof record.blocks === "object" && record.connections && typeof record.connections === "object",
      );
    } catch {
      return false;
    }
  }
}
