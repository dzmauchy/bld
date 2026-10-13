import { beforeAll, describe, expect, test } from "vitest";
import {
  browserContext,
  BrowserCompiler,
  defaultBlockEmitters,
  DiagramCompiler,
  getCompilerContext,
  mcuContext,
  McuCompiler,
  registerCompilerContext,
} from "core/model/compiler.ts";
import { Diagram } from "core/model/diagram.ts";
import { Library } from "core/model/library.ts";
import { Palette } from "core/model/palette.ts";
import { PortEndpoint } from "core/model/endpoint.ts";

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
