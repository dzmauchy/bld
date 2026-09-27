import { expect, test } from "@rstest/core";
import { ClangQualType } from "cpp";
import { BlockDefinition } from "../../src/model/blockDefinition";
import { DiagramAnalysis } from "../../src/model/cppBuilder";
import { Diagram, DiagramPortTypes } from "../../src/model/diagram";
import { PortEndpoint } from "../../src/model/endpoint";
import { InferredPortType } from "../../src/model/inferredPortType";
import { Palette } from "../../src/model/palette";
import { TypeSystem } from "../../src/types";

test("compilation analysis assigns partial types and errors to runtime ports and clears old state", () => {
  const typeSystem = new TypeSystem();
  const definition = BlockDefinition.fromRaw("Test", {
    inputs: { value: { type: "auto" } },
    outputs: { value: { type: "auto" } },
  }, typeSystem);
  const diagram = new Diagram("test", "Test", new Palette(typeSystem));
  const source = diagram.addBlock(definition, { x: 0, y: 0 }, "source");
  const target = diagram.addBlock(definition, { x: 0, y: 0 }, "target");
  const unrelated = diagram.addBlock(definition, { x: 0, y: 0 }, "unrelated");
  const from = new PortEndpoint("source", "output", "value");
  const to = new PortEndpoint("target", "input", "value");
  diagram.connect(from, to, "wire");
  const inferred = new InferredPortType(new ClangQualType("float"), false);
  const types = new DiagramPortTypes();
  types.set("source", "output", "value", inferred);
  const failure = new DiagramAnalysis(false, types, [{
    severity: "error", message: "incompatible types", connectionId: "wire",
    blockId: "target", inputId: "value", outputId: "value", from: from.toJSON(), to: to.toJSON(),
  }]);
  failure.assignTo(diagram);

  const output = source.getOutputPorts()[0]!;
  const input = target.getInputPorts()[0]!;
  expect(output.inferredType).toBe(inferred);
  expect(output.hasError).toBe(true);
  expect(input.inferredType).toBeUndefined();
  expect(input.hasError).toBe(true);
  expect(unrelated.getInputPorts()[0]?.hasError).toBe(false);
  expect(source.getInputPorts()[0]?.hasError).toBe(false);
  expect(target.getOutputPorts()[0]?.hasError).toBe(false);

  types.set("target", "input", "value", inferred);
  new DiagramAnalysis(true, types, []).assignTo(diagram);
  expect(input.inferredType).toBe(inferred);
  expect(input.diagnostics).toEqual([]);
  expect(output.hasError).toBe(false);

  new DiagramAnalysis(false, new DiagramPortTypes(), [{
    severity: "error", message: "invalid configuration", blockId: "target", configId: "size",
  }]).assignTo(diagram);
  expect(input.inferredType).toBeUndefined();
  expect(input.hasError).toBe(true);
  expect(target.getOutputPorts()[0]?.hasError).toBe(true);
  expect(output.hasError).toBe(false);
});
