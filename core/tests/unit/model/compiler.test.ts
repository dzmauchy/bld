import { beforeAll, describe, expect, test } from "@rstest/core";
import {
  browserContext,
  BrowserCompiler,
  defaultBlockEmitters,
  DiagramCompiler,
  getCompilerContext,
  mcuContext,
  McuCompiler,
  registerCompilerContext,
} from "../../../src/model/compiler.ts";
import { Diagram } from "../../../src/model/diagram.ts";
import { Library } from "../../../src/model/library.ts";
import { Palette } from "../../../src/model/palette.ts";
import { PortEndpoint } from "../../../src/model/endpoint.ts";
import { ClangAstDumper } from "cpp";

let palette: Palette;
let libraryFiles: Record<string, string> = {};

beforeAll(async () => {
  const lib = await Library.load("base.json");
  palette = lib.palette;
  libraryFiles = lib.compilationModel.getFiles();
});

function createTestDiagram(): Diagram {
  const diagram = new Diagram("test_diag", "Test Diagram", palette);
  const scope = diagram.addBlock("ScopeF32", { x: 10, y: 10 }, "scope_0", {
    precision: 10,
  });
  const constant = diagram.addBlock("ConstF32", { x: 100, y: 10 }, "const_0", {
    value: 3.14,
  });
  diagram.connect(
    new PortEndpoint(scope.id, "output", "channels", 0),
    new PortEndpoint(constant.id, "input", "downstream", 0),
  );
  return diagram;
}

describe("DiagramCompiler C++ generation", () => {
  test("default compiler targets the browser profile", () => {
    const compiler = new DiagramCompiler({ files: libraryFiles });
    expect(compiler.getProfile().name).toBe("browser");
    expect(compiler.getContext().name).toBe("browser");

    const diagram = createTestDiagram();
    const cpp = compiler.emitText(diagram);
    expect(cpp).toContain("#include <base/f32_blocks.hpp>");
    expect(cpp).toContain("push::f_32::sinks::ScopeF32");
    expect(cpp).toContain("push::f_32::sources::ConstF32");
    expect(cpp).toContain("void mount()");
    expect(cpp).not.toContain("start(");
    expect(cpp).toContain("core::config_arg<0>(::push::f_32::sources::ConstF32, 3.14)");
    expect(cpp).toContain("static auto b0 = ::push::f_32::sinks::ScopeF32(");
    expect(cpp).toContain("core::bind_block(b1, core::detail::move(i1))");
  });

  test("BrowserCompiler specializes the browser profile", () => {
    const compiler = new BrowserCompiler(libraryFiles);
    expect(compiler.getProfile().name).toBe("browser");
  });

  test("McuCompiler leaves the MCU profile unimplemented", async () => {
    const compiler = new McuCompiler(libraryFiles);
    expect(compiler.getProfile().name).toBe("mcu");
    const diagram = createTestDiagram();
    await expect(compiler.compile(diagram)).rejects.toThrow(/MCU wasm profile is not implemented/);
    expect(compiler.emitText(diagram)).toContain("void mount()");
  });

  test("compile without a C++ backend throws", async () => {
    const compiler = new BrowserCompiler(libraryFiles);
    const diagram = createTestDiagram();
    await expect(compiler.compile(diagram)).rejects.toThrow(/C\+\+ compiler backend is required/);
  });

  test("compile delegates generated C++ files to the backend", async () => {
    const captured: Map<string, string>[] = [];
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    const compiler = new DiagramCompiler({
      files: libraryFiles,
      cppCompiler: {
        async compile(files) {
          captured.push(files);
          return wasm;
        },
      },
    });
    const diagram = createTestDiagram();
    const previous = ClangAstDumper.defaultDumper();
    class ForbiddenDumper extends ClangAstDumper {
      override dump(): never { throw new Error("Compilation must not run a preliminary AST pass"); }
    }
    ClangAstDumper.register(new ForbiddenDumper());
    try {
      await expect(compiler.compile(diagram)).resolves.toBe(wasm);
    } finally {
      ClangAstDumper.register(previous);
    }
    expect(captured).toHaveLength(1);
    const files = captured[0];
    expect(files?.get("diagram.cpp")).toContain("void mount()");
    expect(files?.get("diagram.cpp")).toContain("#include \"wasm_host.hpp\"");
    expect(files?.get("base/f32_blocks.hpp")).toContain("ScopeF32(const u32 blockId");
    expect(files?.get("wasm_host.hpp")).toContain("void start()");
    expect(files?.get("wasm_host.cpp")).toBeUndefined();
  });

  test("compiler errors retain connection diagnostics and a successful retry clears them", async () => {
    let fail = true;
    const compiler = new BrowserCompiler(libraryFiles, {
      async compile() {
        if (fail) throw new Error("core/diagram.hpp:185:12: error: incompatible value\nconnection_0:1:1: note: in instantiation of template requested here");
        return new Uint8Array([0, 97, 115, 109]);
      },
    });
    const diagram = createTestDiagram();
    const connection = diagram.getConnections()[0]!;
    const failure = await compiler.compile(diagram).catch(error => error);
    expect(failure.diagnostics[0]).toMatchObject({ blockId: "const_0", inputId: "downstream", connectionId: connection.id });
    expect(diagram.getBlock("const_0")?.getInputPorts()[0]?.hasError).toBe(true);
    fail = false;
    await compiler.compile(diagram);
    expect(diagram.getBlock("const_0")?.getInputPorts()[0]?.hasError).toBe(false);
  });

  test("run instantiates the wasm produced by the C++ backend", async () => {
    const wasm = new Uint8Array([0, 97, 115, 109, 9, 9, 9, 9]);
    const compiler = new BrowserCompiler(libraryFiles, {
      async compile() {
        return wasm;
      },
    });
    let captured: Uint8Array | undefined;
    const session = { close: async () => 0 } as unknown as import("../../../src/model/compiler.ts").WasmSessionLike;
    const runtime = {
      async instantiate(bytes: Uint8Array) {
        captured = bytes;
        return session;
      },
    };
    await expect(compiler.run(createTestDiagram(), runtime)).resolves.toBe(session);
    expect(captured).toBe(wasm);
  });

  test("supports custom context registration", () => {
    registerCompilerContext({ name: "custom_sim" });
    expect(getCompilerContext("custom_sim")?.name).toBe("custom_sim");
  });

  test("Diagram.emitText uses the default browser compiler files when provided", () => {
    const diagram = createTestDiagram();
    const cpp = diagram.emitText(new BrowserCompiler(libraryFiles));
    expect(cpp).toContain("push::f_32::sources::ConstF32(");
  });

  test("setContext switches a compiler onto a registered target", () => {
    const compiler = new DiagramCompiler({ files: libraryFiles });
    expect(compiler.getProfile().name).toBe("browser");

    compiler.setContext("mcu");
    expect(compiler.getProfile().name).toBe("mcu");
    expect(compiler.getContext().name).toBe(mcuContext.name);

    compiler.setProfile("browser");
    expect(compiler.getProfile().name).toBe("browser");
    expect(compiler.getContext().name).toBe(browserContext.name);
  });

  test("every header block has a C++ binding", async () => {
    const lib = await Library.load("base.json");
    for (const id of Object.keys(lib.blocks)) {
      expect(defaultBlockEmitters.has(id), id).toBe(true);
    }
  });
});
