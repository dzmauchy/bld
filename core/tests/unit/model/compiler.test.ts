import { beforeAll, describe, expect, test } from "vitest";
import {
  browserContext,
  BrowserCompiler,
  CompilerContext,
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
import { TestCompiler, testContext } from "../../testCompiler.ts";

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

describe("DiagramCompiler pluggable contexts", () => {
  test("default compiler targets browser without any test code", () => {
    const compiler = new DiagramCompiler();
    expect(compiler.getContext().name).toBe("browser");

    const diagram = createTestDiagram();
    const source = compiler.generateAssemblyScript(diagram);

    // Production browser code assertions
    expect(source).toContain("import { BrowserExecutionContext } from \"./browser_context\"");
    expect(source).toContain("const ec = new BrowserExecutionContext();");
    expect(source).toContain("export function tick(): void { ec.tick(); }");
    expect(source).toContain("export function close(): void { ec.close(); }");
    expect(source).toContain("export function emitGpioIn(");

    // MUST NOT contain any test code
    expect(source).not.toContain("TestExecutionContext");
    expect(source).not.toContain("./harness");
    expect(source).not.toContain("tickThenObserve");
    expect(source).not.toContain("clearPins");
    expect(source).not.toContain("lastPin");
    expect(source).not.toContain("hasPin");
    expect(source).not.toContain("pinWriteCount");
    expect(source).not.toContain("activeIntervalCount");

    // Supplies browser_context.ts in getFiles()
    const files = compiler.getFiles();
    expect(files["browser_context.ts"]).toBeDefined();
    expect(files["browser_context.ts"]).toContain("class BrowserExecutionContext");
  });

  test("BrowserCompiler specializes browser context", () => {
    const compiler = new BrowserCompiler();
    expect(compiler.getContext()).toBe(browserContext);
    const files = compiler.getFiles();
    expect(files["browser_context.ts"]).toBeDefined();
  });

  test("McuCompiler targets MCU execution context", () => {
    const compiler = new McuCompiler();
    expect(compiler.getContext().name).toBe("mcu");

    const diagram = createTestDiagram();
    const source = compiler.generateAssemblyScript(diagram);

    expect(source).toContain("import { McuExecutionContext } from \"./mcu_context\"");
    expect(source).toContain("const ec = new McuExecutionContext();");
    expect(source).toContain("export function tick(): void { ec.tick(); }");
    expect(source).not.toContain("TestExecutionContext");

    const files = compiler.getFiles();
    expect(files["mcu_context.ts"]).toBeDefined();
    expect(files["mcu_context.ts"]).toContain("class McuExecutionContext");
  });

  test("TestCompiler from test infrastructure targets test harness", () => {
    const compiler = new TestCompiler();
    expect(compiler.getContext().name).toBe("test");

    const diagram = createTestDiagram();
    const source = compiler.generateAssemblyScript(diagram);

    expect(source).toContain("import { TestExecutionContext } from \"./harness\"");
    expect(source).toContain("const ec = new TestExecutionContext();");
    expect(source).toContain("export function tickThenObserve(): void");
    expect(source).toContain("export function lastPin(");

    const files = compiler.getFiles();
    expect(files["harness.ts"]).toBeDefined();
    expect(files["harness.ts"]).toContain("class TestExecutionContext");
  });

  test("supports custom context registration", () => {
    const customContext: CompilerContext = {
      name: "custom_sim",
      getFiles() {
        return { "custom.ts": "// custom runtime" };
      },
      getPrelude() {
        return "// Custom Prelude\nconst ec = null;\n";
      },
      getExports() {
        return "export function customTick(): void {}\n";
      },
    };

    registerCompilerContext(customContext);
    expect(getCompilerContext("custom_sim")).toBe(customContext);

    const compiler = new DiagramCompiler("custom_sim");
    expect(compiler.getContext().name).toBe("custom_sim");
    expect(compiler.getFiles()["custom.ts"]).toBe("// custom runtime");

    const diagram = createTestDiagram();
    const source = compiler.generateAssemblyScript(diagram);
    expect(source).toContain("// Custom Prelude");
    expect(source).toContain("export function customTick(): void {}");
  });

  test("Diagram.generateAssemblyScript uses default browser compiler", () => {
    const diagram = createTestDiagram();
    const source = diagram.generateAssemblyScript();

    expect(source).toContain("new BrowserExecutionContext()");
    expect(source).not.toContain("TestExecutionContext");
  });
});
