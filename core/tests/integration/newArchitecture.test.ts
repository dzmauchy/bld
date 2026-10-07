import { beforeAll, describe, expect, test } from "@rstest/core";
import { Library } from "../../src/model/library";
import { Diagram } from "../../src/model/diagram";
import { CppDiagramBuilder } from "../../src/model/cppBuilder";
import { PortEndpoint } from "../../src/model/endpoint";
import { ClangAstDumper, ClangTranslationUnit } from "cpp";
import { ClangFunctionCatalog } from "../../src/model/clangFunctionCatalog";
import { Palette } from "../../src/model/palette";

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
  test("source-local adapters preserve defaults for factories with the same name in different namespaces", async () => {
    const files = { ...library.compilationModel.getFiles(), "custom.hpp": `#pragma once
#include <base/f32_blocks.hpp>
// Same(const u32 blockId, const f32 value = 123) is only a comment.
namespace other {
inline auto Same(const u32 blockId, const f32 value = 99) {
  return push::f_32::sources::ConstF32(blockId, value);
}
}
namespace custom {
inline auto Same(const u32 blockId, const f32 value = f32{0.5}) {
  return push::f_32::sources::ConstF32(blockId, value);
}
}` };
    const palette = Palette.fromCatalog({ Custom: {
      cpp: "custom::Same", inputs: { downstream: { type: "auto", vector: true } },
      conf: { value: { type: "auto" } },
    } }, {});
    const d = new Diagram("custom", "Custom", palette);
    const block = d.addBlock("Custom", { x: 0, y: 0 }, "custom", { value: 3.5 });
    const result = await new CppDiagramBuilder(files).analyze(d);
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
    expect(block.getConf("value")).toBe(3.5);
    expect(block.definition.getConfig("value")?.defaultValue).toBe(0.5);
    expect(result.types.require("custom", "input", "downstream").desugaredQualType).toContain("float");
  });
  test("one full-source invocation resolves defaults and validates configured connections", async () => {
    const freshLibrary = await Library.load("base.json");
    const singlePassBuilder = new CppDiagramBuilder(freshLibrary.compilationModel.getFiles());
    const d = new Diagram("single_pass", "Single pass", freshLibrary.palette);
    const scope = d.addBlock("ScopeF32", { x: 0, y: 0 }, "scope", { precision: 25 });
    const constant = d.addBlock("ConstF32", { x: 1, y: 0 }, "constant", { value: 1 });
    connect(d, "scope", "constant");
    const files = singlePassBuilder.build(d);
    const dumps: Map<string, string>[] = [];
    const host = ClangAstDumper.defaultDumper();
    class RecordingDumper extends ClangAstDumper {
      override dump(inputs: Map<string, string>, mainFile: string) {
        dumps.push(inputs);
        return host.dump(inputs, mainFile);
      }
    }
    const analysis = await singlePassBuilder.analyze(d, new RecordingDumper());
    expect(analysis.ok, JSON.stringify(analysis.diagnostics)).toBe(true);
    expect(dumps).toHaveLength(1);
    expect(dumps[0]?.get("diagram.cpp")).toBe(files.get("diagram.cpp"));
    expect(scope.getConf("period")).toBe(60);
    expect(scope.getConf("precision")).toBe(25);
    expect(scope.definition.getConfig("precision")?.defaultValue).toBe(10);
    expect(constant.toJSON().conf).toBeUndefined();
    expect(analysis.types.require("constant", "input", "downstream").desugaredQualType).toContain("float");
  });
  test("Clang resolves fixed-size array defaults as pin lists", async () => {
    const files = new Map(Object.entries(library.compilationModel.getFiles()));
    files.set("defaults.cpp", `#include <core/types.hpp>
void Pins(u32 blockId, core::array<u8> empty = {},
          core::array<u8> zeroed = core::array<u8>(2),
          core::array<u8> repeated = core::array<u8>(3, u8{7})) {}`);
    const dump = await ClangAstDumper.defaultDumper().dumpAsync(files, "defaults.cpp");
    expect(dump.ok, dump.diagnostics).toBe(true);
    const parameters = ClangFunctionCatalog.fromAst(dump.ast!).parametersFor("Pins");
    expect(parameters?.map((parameter) => parameter.defaultValue)).toEqual([[], [0, 0], [7, 7, 7]]);
  });
  test("metadata exposes both precisions without header comment parsing", () => {
    expect(library.palette.getBlocks()).toHaveLength(22);
    expect(library.palette.getBlock("ScopeF64")?.getOutput("channels")).toBeDefined();
    expect(library.compilationModel.getFile("core/types.hpp")).toContain("core::span");
    expect(library.palette.getBlock("ScopeF32")?.getOutput("channels")?.vector).toBe(true);
    expect(library.palette.getBlock("ConstF32")?.getInput("downstream")?.vector).toBe(true);
    expect(library.palette.getBlock("CosF32")?.getOutput("consumer")?.vector).toBe(false);
  });
  test("all released blocks assemble and infer their actual field types", async () => {
    const d = diagram();
    for (const definition of library.palette.getBlocks()) d.addBlock(definition, {x: 0, y: 0});
    const result = await builder.analyze(d);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.types.require("ScopeF32_0", "output", "channels").desugaredQualType).toContain("function<core::span<core::function<void (float)> *const>");
    expect(result.types.require("ScopeF64_0", "output", "channels").desugaredQualType).toContain("function<core::span<core::function<void (double)> *const>");
    for (const precision of ["F32", "F64"]) {
      expect(library.palette.getBlock(`Scope${precision}`)?.getDefaultConfig()).toEqual({ period: 60, precision: 10 });
      expect(library.palette.getBlock(`PulseGen${precision}`)?.getDefaultConfig()).toEqual({ dutyCycle: 0.5, amplitude: 1, frequency: 1, phase: 0 });
      expect(library.palette.getBlock(`GpioIn${precision}`)?.getDefaultConfig()).toEqual({ port: 0, pins: [0] });
      expect(library.palette.getBlock(`GpioIn${precision}`)?.getConfig("pins")?.type.raw).toContain("core::array");
    }
  });
  test("GPIO vector configuration preserves empty, single and multiple pin lists", async () => {
    const d = diagram();
    const gpio = d.addBlock("GpioInF32", { x: 0, y: 0 }, "gpio");
    for (const pins of [[], [4], [0, 2, 4]]) {
      gpio.setConf("pins", pins);
      const result = await builder.analyze(d);
      expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true);
      expect(gpio.toJSON().conf?.pins).toEqual(pins);
      expect(builder.emitDiagram(d)).toContain(`bld_config_array<decltype(pins)>(${pins.join(", ")})`);
    }
    gpio.setConf("pins", [0]);
    expect(gpio.toJSON().conf).toBeUndefined();
  });
  test("connected program uses auto and factory defaults from Clang", async () => {
    const d = diagram();
    d.addBlock("ScopeF32", {x: 0, y: 0}, "scope");
    const c = d.addBlock("ConstF32", {x: 0, y: 0}, "constant", {value: 2.5});
    connect(d, "scope", "constant");
    const result = await builder.analyze(d);
    expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(result.ok).toBe(true);
    expect(builder.emitDiagram(d)).toContain("static_cast<decltype(value)>(2.5)");
    c.setConf("value", 1);
    expect(c.toJSON().conf).toBeUndefined();
  });
  test("single-channel wiring borrows a span while combined channels keep their own storage", async () => {
    const d = diagram();
    d.addBlock("ScopeF32", { x: 0, y: 0 }, "scope_a");
    d.addBlock("ScopeF32", { x: 0, y: 0 }, "scope_b");
    d.addBlock("ConstF32", { x: 0, y: 0 }, "single");
    d.addBlock("ConstF32", { x: 0, y: 0 }, "combined");
    d.connect(new PortEndpoint("scope_a", "output", "channels", 2), new PortEndpoint("single", "input", "downstream"));
    d.connect(new PortEndpoint("scope_a", "output", "channels", 0), new PortEndpoint("combined", "input", "downstream"));
    d.connect(new PortEndpoint("scope_b", "output", "channels", 0), new PortEndpoint("combined", "input", "downstream"));
    const analysis = await builder.analyze(d);
    expect(analysis.ok, JSON.stringify(analysis.diagnostics)).toBe(true);
    const dump = await ClangAstDumper.defaultDumper().dumpAsync(builder.build(d), "diagram.cpp");
    expect(dump.ok, dump.diagnostics).toBe(true);
    const unit = ClangTranslationUnit.parse(dump.ast);
    expect(unit.varType("input_2_downstream")?.canonical).toMatch(/^core::span</);
    expect(unit.varType("input_3_downstream")?.canonical).toMatch(/^BldInput</);
  });
  test("incompatible precision identifies the exact connection and endpoints", async () => {
    const d = diagram();
    d.addBlock("ScopeF64", {x: 0, y: 0}, "scope/a");
    d.addBlock("ConstF32", {x: 0, y: 0}, "constant");
    connect(d, "scope/a", "constant");
    const result = await builder.analyze(d);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.find((d) => d.severity === "error"), JSON.stringify(result.diagnostics)).toMatchObject({ connectionId: "wire", blockId: "constant", inputId: "downstream", outputId: "channels" });
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
