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

let palette: Palette;
let libraryFiles: Record<string, string> = {};

beforeAll(async () => {
  const lib = await Library.load("base.json");
  palette = lib.palette;
  libraryFiles = lib.compilationModel.getFiles();
});

function createTestDiagram(): Diagram {
  const diagram = new Diagram("test_diag", "Test Diagram", palette);
  const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 }, "scope_0", {
    precision: 10,
  });
  const constant = diagram.addBlock("const_f32", { x: 100, y: 10 }, "const_0", {
    v: 3.14,
  });
  diagram.connect(
    new PortEndpoint(constant.id, "input", "downstream", 0),
    new PortEndpoint(scope.id, "output", "out", 0),
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
    expect(cpp).toContain("#include <base.hpp>");
    expect(cpp).toContain("push::f32::sinks::ScopeF32");
    expect(cpp).toContain("push::f32::sources::ConstF32");
    expect(cpp).toContain("void mount()");
    expect(cpp).not.toContain("start(");
    expect(cpp).toContain("3.14f");
    expect(cpp).toContain("->apply(");
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
    await expect(compiler.compile(diagram)).resolves.toBe(wasm);
    expect(captured).toHaveLength(1);
    const files = captured[0];
    expect(files?.get("diagram.cpp")).toContain("void mount()");
    expect(files?.get("diagram.cpp")).toContain("#include <browser/host.hpp>");
    expect(files?.get("base/f32_blocks.hpp")).toContain("class ScopeF32");
    expect(files?.get("browser/host.hpp")).toContain("void start()");
    expect(files?.get("wasm_host.cpp")).toBeUndefined();
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
    expect(cpp).toContain("new push::f32::sources::ConstF32");
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
