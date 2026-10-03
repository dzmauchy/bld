import { beforeAll, describe, expect, test } from "@rstest/core";
import { Library } from "../../src/model/library";
import { Diagram } from "../../src/model/diagram";
import { CppDiagramBuilder } from "../../src/model/cppBuilder";
import { PortEndpoint } from "../../src/model/endpoint";

let library: Library;
let builder: CppDiagramBuilder;
beforeAll(async () => {
  library = await Library.load("base.json");
  builder = new CppDiagramBuilder(library.compilationModel.getFiles());
});
function diagram() { return new Diagram("test", "Test", library.palette); }
function connect(d: Diagram, source: string, target: string) {
  d.connect(new PortEndpoint(source, "output", "channels"), new PortEndpoint(target, "input", "downstream"), "wire");
}
describe("release metadata and diagram AST", () => {
  test("metadata exposes both precisions without header comment parsing", () => {
    expect(library.palette.getBlocks()).toHaveLength(22);
    expect(library.palette.getBlock("ScopeF64")?.getOutput("channels")).toBeDefined();
    expect(library.compilationModel.getFile("core/array.hpp")).toContain("class Array");
  });
  test("all released blocks assemble and infer their actual field types", async () => {
    const d = diagram();
    for (const definition of library.palette.getBlocks()) d.addBlock(definition, {x: 0, y: 0});
    const result = await builder.analyze(d);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.types.require("ScopeF32_0", "output", "channels").desugaredQualType).toContain("Consumer<float>");
    expect(result.types.require("ScopeF64_0", "output", "channels").desugaredQualType).toContain("Consumer<double>");
  });
  test("connected program uses auto and constructor defaults from Clang", async () => {
    const d = diagram();
    d.addBlock("ScopeF32", {x: 0, y: 0}, "scope");
    const c = d.addBlock("ConstF32", {x: 0, y: 0}, "constant", {value: 2.5});
    connect(d, "scope", "constant");
    const result = await builder.analyze(d);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(builder.emitDiagram(d)).toContain("(1u, 2.5f)");
    c.setConf("value", 1);
    expect(c.toJSON().conf).toBeUndefined();
  });
  test("incompatible precision identifies the exact connection and endpoints", async () => {
    const d = diagram();
    d.addBlock("ScopeF64", {x: 0, y: 0}, "scope/a");
    d.addBlock("ConstF32", {x: 0, y: 0}, "constant");
    connect(d, "scope/a", "constant");
    const result = await builder.analyze(d);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.find((d) => d.severity === "error")).toMatchObject({ connectionId: "wire", blockId: "constant", inputId: "downstream", outputId: "channels" });
    expect(result.toJSON().ports.length).toBeGreaterThan(0);
  });
  test("configuration changes are reanalyzed and invalid pin indices are identified", async () => {
    const d = diagram();
    d.addBlock("ScopeF32", {x: 0, y: 0}, "s");
    const gpio = d.addBlock("GpioInF32", {x: 0, y: 0}, "g", { pins: [0, 1] });
    d.connect(new PortEndpoint("s", "output", "channels", 1), new PortEndpoint("g", "input", "pins", 1), "pin");
    expect((await builder.analyze(d)).ok).toBe(true);
    gpio.setConf("pins", [0]);
    const result = await builder.analyze(d);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ blockId: "g", inputId: "pins", connectionId: "pin" });
  });
  test("unknown configuration is returned as a block diagnostic", async () => {
    const d = diagram();
    d.addBlock("ConstF32", {x: 0, y: 0}, "c", { typo: 2 });
    const result = await builder.analyze(d);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({ blockId: "c", configId: "typo" });
  });
  test("async connection checking leaves the diagram unchanged", async () => {
    const d = diagram();
    d.addBlock("ScopeF64", {x: 0, y: 0}, "s");
    d.addBlock("ConstF32", {x: 0, y: 0}, "c");
    const result = await d.canConnectAsync(new PortEndpoint("s", "output", "channels"), new PortEndpoint("c", "input", "downstream"));
    expect(result.ok).toBe(false);
    expect(d.getConnections()).toHaveLength(0);
  });

});
