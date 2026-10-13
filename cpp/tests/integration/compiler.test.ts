import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { CppWasmCompiler } from "cpp/compiler.ts";
import { ClangComment, ClangTranslationUnit, type ClangAstJson } from "cpp/clangAst.ts";
import type { CompilationPhaseEvent } from "cpp/compilationProgress.ts";
import { execute, serveToolchain } from "../toolchain.ts";

let assets: Awaited<ReturnType<typeof serveToolchain>>;
let compiler: CppWasmCompiler;
beforeAll(async () => {
  assets = await serveToolchain();
  compiler = new CppWasmCompiler(assets.assetUrl);
}, 120_000);
afterAll(async () => { await assets?.close(); });

const source = (text: string) => new Map([["main.cpp", text]]);
const answer = async (files: Map<string, string>) => (await execute(await compiler.compile(files))).answer as () => number;

describe("released Clang/LLD under Node.js", () => {
  test("initializes once and compiles multiple translation units with real sysroot headers", async () => {
    const preparation = compiler.initialize();
    expect(compiler.initialize()).toBe(preparation);
    await preparation;
    const events: CompilationPhaseEvent[] = [];
    const files = new Map([
      ["value.hpp", "#pragma once\nint add(int, int);"],
      ["nested/add.cpp", '#include "value.hpp"\nint add(int a, int b) { return a + b; }'],
      ["main.cpp", '#include <stddef.h>\n#include "value.hpp"\nstatic_assert(sizeof(size_t) == 4);\nextern "C" int answer() { return add(40, 2); }'],
    ]);
    const wasm = await compiler.compile(files, event => events.push(event));
    expect(((await execute(wasm)).answer as () => number)()).toBe(42);
    expect(events).toEqual([
      { phase: "compilation", status: "active" }, { phase: "compilation", status: "completed" },
      { phase: "linking", status: "active" }, { phase: "linking", status: "completed" },
    ]);
    expect(assets.requests.slice().sort()).toEqual(["clang.js", "clang.wasm", "lld.js", "lld.wasm", "sysroot.tgz"]);
  });

  test("links the object from an AST dump, then recompiles changed source and headers", async () => {
    const files = new Map([
      ["value.hpp", "#pragma once\ninline int value() { return 42; }"],
      ["main.cpp", '#include "value.hpp"\nextern "C" int answer() { auto inferred = value(); return inferred; }'],
    ]);
    const first = await compiler.dumpAst(files, "main.cpp");
    expect(first.ok, first.stderr).toBe(true);
    expect(ClangTranslationUnit.parse(first.ast).varType("inferred")?.canonical).toBe("int");
    expect(await compiler.dumpAst(files, "main.cpp")).toEqual(first);
    expect((await answer(files))()).toBe(42);
    files.set("value.hpp", "#pragma once\ninline double value() { return 43.5; }");
    const changed = await compiler.dumpAst(files, "main.cpp");
    expect(changed.ok, changed.stderr).toBe(true);
    expect(ClangTranslationUnit.parse(changed.ast).varType("inferred")?.canonical).toBe("double");
    expect((await answer(files))()).toBe(43);
    files.set("main.cpp", 'extern "C" int answer() { return 44; }');
    files.delete("value.hpp");
    expect((await answer(files))()).toBe(44);
    files.set("main.cpp", '#include "value.hpp"\nextern "C" int answer() { return value(); }');
    await expect(compiler.compile(files)).rejects.toThrow(/value.hpp.*file not found/);
  });

  test("comment-only edits update diagram and block metadata in the actual AST", async () => {
    const metadata = { id: "diagram-π", title: "Before", blocks: { "block-π": {} }, connections: { wire: {} } };
    const files = source(`// ${JSON.stringify(metadata)}\nextern "C" void mount() {\n// {"kind":"block","id":"block-π"}\nstatic auto block = 1; (void)block; }`);
    const comments = (ast: unknown) => {
      const result = new Map<string, unknown>();
      const visit = (node: ClangAstJson) => {
        if (node.name) result.set(node.name, ClangComment.of(node)?.asJson()?.value);
        node.inner?.forEach(visit);
      };
      visit(ast as ClangAstJson);
      return result;
    };
    const first = await compiler.dumpAst(files, "main.cpp");
    expect(first.ok, first.stderr).toBe(true);
    expect(comments(first.ast).get("mount")).toEqual(metadata);
    expect(comments(first.ast).get("block")).toEqual({ kind: "block", id: "block-π" });
    metadata.title = "After";
    files.set("main.cpp", files.get("main.cpp")!.replace('"Before"', '"After"'));
    await compiler.compile(files);
    const changed = await compiler.dumpAst(files, "main.cpp");
    expect(changed.ok, changed.stderr).toBe(true);
    expect(comments(changed.ast).get("mount")).toEqual(metadata);
  });

  test("preserves real warnings, source locations, and cached diagnostics", async () => {
    const files = source('#warning source warning\n#line 1 "remapped.hpp"\n#warning remapped warning\nextern "C" int answer() { return 42; }');
    const first = await compiler.dumpAst(files, "main.cpp");
    expect(first.ok, first.stderr).toBe(true);
    expect(first.stderr).toContain("source warning");
    expect(first.stderr).toContain("remapped.hpp");
    expect(JSON.stringify(first.ast)).toContain("/work/main.cpp");
    expect(await compiler.dumpAst(files, "main.cpp")).toEqual(first);
    expect((await answer(files))()).toBe(42);
  });

  test("reports syntax errors without stale ASTs and recovers on the same compiler", async () => {
    const files = source('extern "C" int answer() { return 42; }');
    expect((await compiler.dumpAst(files, "main.cpp")).ok).toBe(true);
    files.set("main.cpp", '#error deliberately invalid source');
    const failed = await compiler.dumpAst(files, "main.cpp");
    expect(failed.ok).toBe(false);
    expect(failed.stderr).toContain("deliberately invalid source");
    expect(JSON.stringify(failed.ast) ?? "").not.toContain('"name":"answer"');
    files.set("main.cpp", 'extern "C" int answer() { return 43; }');
    expect((await answer(files))()).toBe(43);
  });

  test.each(["compilation", "linking"] as const)("keeps failed %s active and preserves native diagnostics", async phase => {
    const files = source(phase === "compilation"
      ? 'extern "C" int answer() { return missing_value; }'
      : 'extern int missing_function(); extern "C" int answer() { return missing_function(); }');
    const events: CompilationPhaseEvent[] = [];
    await expect(compiler.compile(files, event => events.push(event))).rejects.toThrow(
      phase === "compilation" ? /undeclared identifier.*missing_value/ : /undefined symbol.*missing_function/);
    expect(events.at(-1)).toEqual({ phase, status: "active" });
    expect(events).not.toContainEqual({ phase, status: "completed" });
    expect((await answer(source('extern "C" int answer() { return 42; }')))()).toBe(42);
  });

  test("rejects empty sources and colliding output stems", async () => {
    await expect(compiler.compile(new Map([["header.hpp", "int value;"]]))).rejects.toThrow("no C or C++ source");
    await expect(compiler.compile(new Map([["a/main.cpp", "int a;"], ["b/main.cpp", "int b;"]]))).rejects.toThrow("same output");
    await expect(compiler.dumpAst(source("int value;"), "missing.cpp")).rejects.toThrow("missing C or C++ source");
  });

  test("retries a failed HTTP download using the same compiler without fabricated runtimes", async () => {
    assets.failures.set("clang.js", 1);
    const fresh = new CppWasmCompiler(assets.assetUrl);
    await expect(fresh.initialize()).rejects.toThrow(/clang.js: 503/);
    await Promise.all([fresh.initialize(), fresh.initialize()]);
    const wasm = await fresh.compile(source('extern "C" int answer() { return 45; }'));
    expect(((await execute(wasm)).answer as () => number)()).toBe(45);
  });
});
