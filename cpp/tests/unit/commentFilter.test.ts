import { describe, expect, test } from "vitest";
import { DiagramMetaCommentFilter } from "../../src/commentFilter.ts";

const filter = new DiagramMetaCommentFilter();

describe("DiagramMetaCommentFilter", () => {
  test("drops a // JSON run and stabilizes a short mount source", () => {
    const source = [
      "#include <base.hpp>",
      "// {\"id\":\"prod_wait\",",
      "// \"title\":\"prod_wait\",",
      "// \"blocks\":{\"s\":{}},\"connections\":{}}",
      "extern \"C\" void mount() {}",
      "",
    ].join("\n");
    const filtered = filter.apply(source);
    expect(filtered).not.toContain("prod_wait");
    expect(filtered).toContain("extern \"C\" void mount() {}");
    expect(filtered).toContain("#include <base.hpp>");
    expect(filtered).toContain("static constexpr char bld_clang_source_padding[]");
    expect(filtered.indexOf("bld_clang_source_padding")).toBeLessThan(filtered.indexOf('extern "C" void mount()'));
    expect(new TextEncoder().encode(filtered)).toHaveLength(857);
  });

  test("drops a block-comment diagram and keeps header kind comments", () => {
    const source = [
      "/*{\"kind\":\"block\",\"id\":\"scope_f32\",\"title\":\"Scope\"}*/",
      "class ScopeF32 {};",
      "/*{\"id\":\"demo\",\"blocks\":{},\"connections\":{}}*/",
      "extern \"C\" void mount() {}",
      "",
    ].join("\n");
    const filtered = filter.apply(source);
    expect(filtered).toContain("kind");
    expect(filtered).toContain("class ScopeF32 {};");
    expect(filtered).not.toContain("\"id\":\"demo\"");
    expect(filtered).toContain("void mount()");
  });

  test("does not pad a metadata-free body above the short-source limit", () => {
    const body = `extern "C" void mount() { static constexpr char payload[] = "${"x".repeat(600)}"; }`;
    const source = [
      "// {\"id\":\"large\",\"blocks\":{},\"connections\":{}}",
      body,
      "",
    ].join("\n");
    const filtered = filter.apply(source);
    expect(filtered).toBe(`${body}\n`);
    expect(filtered).not.toContain("bld_clang_source_padding");
  });

  test("keeps ordinary line comments", () => {
    const source = "// not json\nextern \"C\" int add() { return 1; }\n";
    expect(filter.apply(source)).toBe(source);
  });
});
