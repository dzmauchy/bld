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
} from "../../../src/model/compiler.ts";
import { Diagram } from "../../../src/model/diagram.ts";
import { Library } from "../../../src/model/library.ts";
import { Palette } from "../../../src/model/palette.ts";
import { PortEndpoint } from "../../../src/model/endpoint.ts";
import { mcuProfile } from "../../../src/wasm/profile.ts";

let palette: Palette;

beforeAll(async () => {
  const lib = await Library.load("base.json");
  palette = lib.palette;
});

function createTestDiagram(): Diagram {
  const diagram = new Diagram("test_diag", "Test Diagram", palette);
  const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 }, "scope_0", {
    precision: 10,
  });
  const constant = diagram.addBlock("const_f32", { x: 100, y: 10 }, "const_0", {
    precision: 10,
    v: 3.14,
  });
  diagram.connect(
    new PortEndpoint(constant.id, "input", "v", 0),
    new PortEndpoint(scope.id, "output", "sink", 0),
  );
  return diagram;
}

describe("DiagramCompiler wasm profiles", () => {
  test("default compiler targets the browser profile", () => {
    const compiler = new DiagramCompiler();
    expect(compiler.getProfile().name).toBe("browser");
    expect(compiler.getContext().name).toBe("browser");

    const diagram = createTestDiagram();
    const wat = compiler.emitText(diagram);
    expect(wat).toContain("(func $tick");
    expect(wat).toContain("(func $b0_push");
    expect(wat).toContain("(func $b1_tick");
    expect(wat).toContain("(export \"tick\"");
    expect(wat).toContain("(export \"emitGpioIn\"");
    expect(wat).toContain("i32.atomic.rmw.add");
    expect(wat).toContain("return_call");
    expect(wat).toContain("wasm:js-string");
    expect(wat).toContain("array.new");
    expect(wat).toContain("(try");
    expect(wat).toContain("(memory $0 1 1 shared)");
    expect(wat).not.toContain("AssemblyScript");
  });

  test("BrowserCompiler specializes the browser profile", () => {
    const compiler = new BrowserCompiler();
    expect(compiler.getProfile().name).toBe("browser");
  });

  test("McuCompiler leaves the MCU profile unimplemented", () => {
    const compiler = new McuCompiler();
    expect(compiler.getProfile().name).toBe("mcu");
    expect(compiler.getProfile()).toBe(mcuProfile);
    const diagram = createTestDiagram();
    expect(() => compiler.compile(diagram)).toThrow(/MCU wasm profile is not implemented/);
    expect(() => compiler.emitText(diagram)).toThrow(/not implemented/);
  });

  test("supports custom context registration", () => {
    registerCompilerContext({ name: "custom_sim" });
    expect(getCompilerContext("custom_sim")?.name).toBe("custom_sim");
  });

  test("Diagram.emitText uses the default browser compiler", () => {
    const diagram = createTestDiagram();
    const wat = diagram.emitText();
    expect(wat).toContain("(func $tick");
    expect(wat).toContain("return_call");
  });

  test("setContext switches a compiler onto a registered target", () => {
    const compiler = new DiagramCompiler();
    expect(compiler.getProfile().name).toBe("browser");

    compiler.setContext("mcu");
    expect(compiler.getProfile().name).toBe("mcu");
    expect(compiler.getContext().name).toBe(mcuContext.name);

    compiler.setProfile("browser");
    expect(compiler.getProfile().name).toBe("browser");
    expect(compiler.getContext().name).toBe(browserContext.name);
  });

  test("registers default block emitters used by diagram codegen", () => {
    expect(defaultBlockEmitters.has("scope_f32")).toBe(true);
    expect(defaultBlockEmitters.has("const_f32")).toBe(true);
    expect(defaultBlockEmitters.has("gpio_in")).toBe(true);
    expect(defaultBlockEmitters.has("unknown_block")).toBe(false);
  });

  test("every blocks.json entry has a wasm emitter", async () => {
    const lib = await Library.load("base.json");
    for (const id of Object.keys(lib.blocks)) {
      expect(defaultBlockEmitters.has(id), id).toBe(true);
    }
  });
});
