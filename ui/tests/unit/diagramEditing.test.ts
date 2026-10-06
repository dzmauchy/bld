import { expect, test } from "@rstest/core";
import { dia, shapes } from "@joint/core";
import { Diagram, Library, type BlockDefinition, type PackageManifest } from "core";
import { CanvasPoint, OrthogonalRoute, PointerTravel, WirePoint } from "../../src/view/diagram/geometry.js";
import { DiagramBlockFrame } from "../../src/view/diagram/diagramBlockFrame.js";
import { DiagramConnector, PortHit } from "../../src/view/diagram/diagramConnector.js";
import { JointRouteReader } from "../../src/view/diagram/jointRouteReader.js";
import { PaletteArm } from "../../src/view/diagram/paletteArm.js";

const manifest: PackageManifest = {
  id: "demo",
  name: "Demo",
  icon: "library-base.svg",
  location: "memory:demo",
};

function demoLibrary(): Library {
  return Library.fromManifest(manifest, {
    blocks: {
      ScopeF32: {
        ns: ["push", "f32", "sinks"],
        title: "Scope",
        outputs: { channels: { type: "f32", vector: true } },
      },
      ConstF32: {
        ns: ["push", "f32", "sources"],
        title: "Constant",
        inputs: { downstream: { type: "f32" } },
      },
      SumF32: {
        ns: ["push", "f32", "transformers"],
        title: "Sum",
        inputs: { downstream: { type: "f32" } },
        outputs: { channels: { type: "f32", vector: true } },
      },
    },
  });
}

test("distributes ports the same way JointJS lays out left and right groups", () => {
  const frame = DiagramBlockFrame.fromPorts(["downstream"], ["channels", "extra"]);
  const element = new shapes.standard.Rectangle({
    position: { x: 0, y: 0 },
    size: { width: frame.width, height: frame.height },
    ports: frame.jointPorts(),
  });
  const inputs = element.getPortsPositions("input");
  const outputs = element.getPortsPositions("output");
  expect(inputs["input:downstream"]).toMatchObject({ x: 0, y: frame.port("input", "downstream")?.y });
  expect(outputs["output:channels"]).toMatchObject({ x: frame.width, y: frame.port("output", "channels")?.y });
  expect(outputs["output:extra"]).toMatchObject({ x: frame.width, y: frame.port("output", "extra")?.y });
});

test("reads a routed link as port centers plus anchor deltas", () => {
  const graph = new dia.Graph();
  graph.addCell(
    new shapes.standard.Rectangle({
      id: "scope",
      position: { x: 10, y: 20 },
      size: { width: 156, height: 72 },
      ports: {
        groups: { output: { position: { name: "right" } } },
        items: [{ id: "output:channels", group: "output" }],
      },
    }),
  );
  graph.addCell(
    new shapes.standard.Rectangle({
      id: "constant",
      position: { x: 300, y: 80 },
      size: { width: 156, height: 72 },
      ports: {
        groups: { input: { position: { name: "left" } } },
        items: [{ id: "input:downstream", group: "input" }],
      },
    }),
  );
  const link = new shapes.standard.Link({
    id: "wire",
    source: { id: "scope", port: "output:channels" },
    target: { id: "constant", port: "input:downstream" },
  });
  graph.addCell(link);
  link.set({
    source: { id: "scope", port: "output:channels", anchor: { name: "modelCenter", args: { dx: 3, dy: -1 } } },
    target: { id: "constant", port: "input:downstream", anchor: { name: "modelCenter", args: { dx: 0, dy: 2 } } },
    vertices: [{ x: 200, y: 56 }, { x: 200, y: 116 }],
  });
  const points = JointRouteReader.read(graph, link);
  expect(points?.map((point) => [point.x, point.y])).toEqual([
    [10 + 156 + 3, 20 + 36 - 1],
    [200, 56],
    [200, 116],
    [300 + 0, 80 + 36 + 2],
  ]);
});

test("arms a palette block until the same block is clicked again", () => {
  const library = demoLibrary();
  const scope = library.palette.getBlock("ScopeF32");
  const constant = library.palette.getBlock("ConstF32");
  expect(scope).toBeDefined();
  expect(constant).toBeDefined();
  const arm = new PaletteArm();
  expect(arm.toggle(scope as BlockDefinition)?.id).toBe("ScopeF32");
  expect(arm.isArmed("ScopeF32")).toBe(true);
  expect(arm.toggle(constant as BlockDefinition)?.id).toBe("ConstF32");
  expect(arm.toggle(constant as BlockDefinition)).toBeUndefined();
  expect(arm.definition).toBeUndefined();
});

test("centers a dropped block on the pointer and keeps it on the canvas", () => {
  expect(CanvasPoint.centered(new WirePoint(200, 100), 156, 72)).toEqual(new WirePoint(122, 64));
  expect(CanvasPoint.centered(new WirePoint(10, 4), 156, 72).x).toBe(0);
  expect(CanvasPoint.centered(new WirePoint(10, 4), 156, 72).y).toBe(0);
  expect(new PointerTravel(0, 0).moved(3, 0)).toBe(false);
  expect(new PointerTravel(0, 0).moved(5, 0)).toBe(true);
  expect(OrthogonalRoute.between(new WirePoint(0, 10), new WirePoint(40, 30)).map((point) => [point.x, point.y])).toEqual([
    [0, 10],
    [20, 10],
    [20, 30],
    [40, 30],
  ]);
});

test("connects an output to an input from either drag direction", () => {
  const library = demoLibrary();
  const diagram = new Diagram("diagram", "Diagram", library.palette);
  const scope = diagram.addBlock("ScopeF32", { x: 10, y: 10 });
  const constant = diagram.addBlock("ConstF32", { x: 240, y: 10 });
  const connector = new DiagramConnector(diagram);
  const connection = connector.tryConnect(
    new PortHit(constant.id, "downstream", "input"),
    new PortHit(scope.id, "channels", "output"),
  );
  expect(connection?.from.blockId).toBe(scope.id);
  expect(connection?.to.blockId).toBe(constant.id);
  expect(connector.tryConnect(new PortHit(scope.id, "channels", "output"), new PortHit(constant.id, "downstream", "input"))).toBeUndefined();
  const other = diagram.addBlock("ScopeF32", { x: 10, y: 120 });
  expect(connector.tryConnect(new PortHit(other.id, "channels", "output"), new PortHit(constant.id, "downstream", "input"))).toBeUndefined();
});
