import { describe, expect, test } from "@rstest/core";
import { ClangFrontend } from "../../src/clang.ts";
import { SharedToolchainFileSystem } from "../../src/sharedFileSystem.ts";
import { DisposableToolFactory, writeClangOutputs } from "../toolchainFixture.ts";
import { WasmLinker } from "../../src/linker.ts";
import { ObjectFile } from "../../src/object-file.ts";

describe("clang frontend and wasm linker", () => {
  test("clang writes headers and sources then emits one object per translation unit", async () => {
    const fs = new SharedToolchainFileSystem();
    let compiled = "";
    const clang = new ClangFrontend(new DisposableToolFactory(fs, (_options, fs, args) => {
      compiled = args.at(-1) ?? "";
      writeClangOutputs(fs, args, new Uint8Array([9, 8, 7]));
      return 0;
    }).create, "clang.wasm", fs);
    await clang.boot();
    const objects = await clang.compile(new Map([
      ["scale.h", "int scale(int);"],
      ["scale.cpp", "#include \"scale.h\"\nint scale(int value) { return value * 3; }"],
    ]));
    expect(compiled).toBe("/work/scale.cpp");
    expect(new TextDecoder().decode(fs.readFile("/work/scale.h"))).toContain("int scale");
    expect(objects).toHaveLength(1);
    expect(objects[0]?.path).toBe("/work/build/scale.o");
    expect(objects[0]?.bytes).toEqual(new Uint8Array([9, 8, 7]));
  });

  test("disposes clang after a compile and boots lazily for the next job", async () => {
    const fs = new SharedToolchainFileSystem();
    const factory = new DisposableToolFactory(fs, (_options, fs, args) => {
      writeClangOutputs(fs, args, new Uint8Array([1]));
      return 0;
    });
    const clang = new ClangFrontend(factory.create, "clang.wasm", fs);
    await clang.boot();
    const sources = new Map([["add.cpp", 'extern "C" int add() { return 1; }']]);
    await clang.compile(sources);
    expect(factory.boots).toBe(1);
    sources.set("add.cpp", 'extern "C" int add() { return 2; }');
    await clang.compile(sources);
    expect(factory.boots).toBe(2);
  });

  test("linker reads object paths from shared storage before producing wasm", async () => {
    const fs = new SharedToolchainFileSystem();
    const seen: string[] = [];
    const linker = new WasmLinker(new DisposableToolFactory(fs, (_options, fs, args) => {
      seen.push(...args);
      fs.writeTree(args.at(-1) ?? "", new Uint8Array([0, 97, 115, 109]));
      return 0;
    }).create, "lld.wasm", fs);
    await linker.boot();
    fs.writeTree("/work/scale.o", new Uint8Array([9, 8, 7]));
    const wasm = await linker.link([new ObjectFile("/work/scale.o", fs)]);
    expect(fs.exists("/work/scale.o")).toBe(true);
    expect(seen).toContain("/work/scale.o");
    expect(wasm).toEqual(new Uint8Array([0, 97, 115, 109]));
  });
});

describe("combined JSON and object compilation", () => {
  test("compiles multiple sources in one invocation and reads their JSON dumps", async () => {
    const fs = new SharedToolchainFileSystem();
    const factory = new DisposableToolFactory(fs, (_options, fs, args) => {
      writeClangOutputs(fs, args);
      return 0;
    });
    const clang = new ClangFrontend(factory.create, "clang.wasm", fs);
    const files = new Map([
      ["value.hpp", "#pragma once\nconstexpr int value = 1;"],
      ["main.cpp", '#include "value.hpp"\nint answer() { return value; }'],
      ["nested/other.cpp", '#include "value.hpp"\nint other() { return value + 1; }'],
    ]);
    const objects = await clang.compile(files);
    expect(factory.runs).toEqual([["-o", "/work/build", "/work/main.cpp", "/work/nested/other.cpp"]]);
    expect(objects.map((object) => object.ast)).toEqual([{ kind: "TranslationUnitDecl" }, { kind: "TranslationUnitDecl" }]);
    expect((await clang.dumpAst(files, "main.cpp")).ok).toBe(true);
    expect(factory.runs).toHaveLength(1);
  });

  test("links the object already produced by a successful AST analysis", async () => {
    const fs = new SharedToolchainFileSystem();
    const factory = new DisposableToolFactory(fs, (_options, fs, args) => { writeClangOutputs(fs, args); return 0; });
    const clang = new ClangFrontend(factory.create, "clang.wasm", fs);
    const files = new Map([["main.cpp", "int answer = 42;"]]);
    expect((await clang.dumpAst(files, "main.cpp")).ast).toMatchObject({ kind: "TranslationUnitDecl" });
    expect((await clang.compile(files))[0]?.bytes).toEqual(new Uint8Array([42]));
    expect(factory.runs).toHaveLength(1);
    files.set("main.cpp", "int answer = 43;");
    await clang.compile(files);
    expect(factory.runs).toHaveLength(2);
  });

  test("reads reduced JSON unchanged, including remapped source locations and cached diagnostics", async () => {
    const fs = new SharedToolchainFileSystem();
    const ast = {
      id: "unit", kind: "TranslationUnitDecl",
      inner: [{ kind: "FunctionDecl", name: "answer", loc: { file: "remapped.hpp", line: 1 }, inner: [] }],
    };
    const factory = new DisposableToolFactory(fs, (options, fs, args) => {
      options?.printErr?.("warning: source warning");
      writeClangOutputs(fs, args, new Uint8Array([42]), ast);
      return 0;
    });
    const clang = new ClangFrontend(factory.create, "clang.wasm", fs);
    const files = new Map([["main.cpp", '#line 1 "remapped.hpp"\nint answer() { return 42; }']]);
    const first = await clang.dumpAst(files, "main.cpp");
    const cached = await clang.dumpAst(files, "main.cpp");
    expect(first).toMatchObject({ ok: true, ast, stderr: "warning: source warning" });
    expect(cached).toEqual(first);
    await clang.compile(files);
    expect(factory.runs).toHaveLength(1);
  });

  test("a failed dump reports diagnostics and never reuses a previous JSON file", async () => {
    const fs = new SharedToolchainFileSystem();
    const factory = new DisposableToolFactory(fs, (options, fs, args) => {
      if (new TextDecoder().decode(fs.readFile("/work/main.cpp")) === "invalid") {
        options?.printErr?.("error: invalid source");
        return 1;
      }
      writeClangOutputs(fs, args);
      return 0;
    });
    const clang = new ClangFrontend(factory.create, "clang.wasm", fs);
    const files = new Map([["main.cpp", "int answer = 42;"]]);
    expect((await clang.dumpAst(files, "main.cpp")).ok).toBe(true);
    files.set("main.cpp", "invalid");
    expect(await clang.dumpAst(files, "main.cpp")).toMatchObject({ ok: false, ast: undefined, stderr: "error: invalid source" });
    files.set("main.cpp", "int answer = 43;");
    expect((await clang.compile(files))[0]?.ast).toEqual({ kind: "TranslationUnitDecl" });
    expect(factory.runs).toHaveLength(3);
  });

  test("rejects duplicate output stems before invoking clang", async () => {
    const fs = new SharedToolchainFileSystem();
    const factory = new DisposableToolFactory(fs, () => 0);
    const clang = new ClangFrontend(factory.create, "clang.wasm", fs);
    await expect(clang.compile(new Map([["a/main.cpp", "int a;"], ["b/main.cpp", "int b;"]]))).rejects.toThrow("same output");
    expect(factory.runs).toHaveLength(0);
  });
});
