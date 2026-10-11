import { expect, test } from "@rstest/core";
import { Diagram, Library, type BlockDefinition, type PackageManifest } from "core";
import { CanvasPoint, OrthogonalRoute, PointerTravel, WirePoint } from "../../src/view/diagram/geometry.js";
import { DiagramBlockFrame, PlacedBlock } from "../../src/view/diagram/diagramBlockFrame.js";
import { DiagramConnector, PortHit } from "../../src/view/diagram/diagramConnector.js";
import { BlockMoveGesture, type DiagramGestureHost } from "../../src/view/diagram/diagramGestures.js";
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

test("distributes input and output ports along the block's left and right sides", () => {
  const frame = DiagramBlockFrame.fromPorts(["downstream"], ["channels", "extra"]);
  expect(frame.port("input", "downstream")).toMatchObject({ x: 0, y: 36 });
  expect(frame.port("output", "channels")).toMatchObject({ x: frame.width, y: 18 });
  expect(frame.port("output", "extra")).toMatchObject({ x: frame.width, y: 54 });
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

test("gives every multiplexed connection its own lane and grows only that side", () => {
  const library = Library.fromManifest(manifest, {
    blocks: {
      ScopeF32: {
        ns: ["push", "f32", "sinks"],
        title: "Scope",
        outputs: { channels: { type: "f32", vector: true } },
      },
      ConstF32: {
        ns: ["push", "f32", "sources"],
        title: "Constant",
        inputs: { downstream: { type: "f32", vector: true } },
      },
      SumF32: {
        ns: ["push", "f32", "transformers"],
        title: "Sum",
        inputs: { downstream: { type: "f32", vector: true } },
        outputs: { channels: { type: "f32", vector: true } },
      },
    },
  });
  const diagram = new Diagram("diagram", "Diagram", library.palette);
  const scope = diagram.addBlock("ScopeF32", { x: 0, y: 40 });
  const sum = diagram.addBlock("SumF32", { x: 220, y: 40 });
  const upper = diagram.addBlock("ConstF32", { x: 460, y: 0 });
  const lower = diagram.addBlock("ConstF32", { x: 460, y: 140 });
  const connector = new DiagramConnector(diagram);
  connector.tryConnect(new PortHit(scope.id, "channels", "output"), new PortHit(sum.id, "downstream", "input"));
  connector.tryConnect(new PortHit(sum.id, "channels", "output"), new PortHit(upper.id, "downstream", "input"));
  connector.tryConnect(new PortHit(sum.id, "channels", "output"), new PortHit(lower.id, "downstream", "input"));

  const placed = PlacedBlock.from(sum, diagram.getConnections());
  const output = placed.frame.port("output", "channels");
  const input = placed.frame.port("input", "downstream");
  expect(output?.lanes).toBe(2);
  expect(output?.span).toBe(2 * DiagramBlockFrame.lanePitch);
  expect(output?.pins().map((pin) => pin.index)).toEqual([0, 1]);
  expect(input?.lanes).toBe(1);
  expect(placed.frame.height).toBe(DiagramBlockFrame.minHeight);
  const first = placed.anchor("output", "channels", 0);
  const second = placed.anchor("output", "channels", 1);
  expect(second && first && second.y - first.y).toBe(DiagramBlockFrame.lanePitch);
  expect(first?.x).toBe(placed.x + placed.frame.width);
  expect(placed.anchor("output", "channels")?.y).toBe(placed.y + (output?.y ?? 0));

  const extra = diagram.addBlock("ScopeF32", { x: 0, y: 200 });
  connector.tryConnect(new PortHit(extra.id, "channels", "output"), new PortHit(upper.id, "downstream", "input"));
  const grown = PlacedBlock.from(upper, diagram.getConnections());
  expect(grown.frame.port("input", "downstream")?.lanes).toBe(2);
  const low = grown.anchor("input", "downstream", 0);
  const high = grown.anchor("input", "downstream", 1);
  expect(high && low && high.y - low.y).toBe(DiagramBlockFrame.lanePitch);
  expect(low?.x).toBe(grown.x);
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

test("gives each scope output its own channel when several sources are connected", () => {
  const library = Library.fromManifest(manifest, {
    blocks: {
      ScopeF32: {
        ns: ["push", "f32", "sinks"],
        title: "Scope",
        outputs: { channels: { type: "f32", vector: true } },
      },
      SinGenF32: {
        ns: ["push", "f32", "sources"],
        title: "sin",
        inputs: { downstream: { type: "f32", vector: true } },
      },
      CosGenF32: {
        ns: ["push", "f32", "sources"],
        title: "cos",
        inputs: { downstream: { type: "f32", vector: true } },
      },
    },
  });
  const diagram = new Diagram("diagram", "Diagram", library.palette);
  const scope = diagram.addBlock("ScopeF32", { x: 0, y: 0 });
  const sin = diagram.addBlock("SinGenF32", { x: 200, y: 0 });
  const cos = diagram.addBlock("CosGenF32", { x: 200, y: 120 });
  const connector = new DiagramConnector(diagram);
  const first = connector.tryConnect(new PortHit(scope.id, "channels", "output"), new PortHit(sin.id, "downstream", "input"));
  const second = connector.tryConnect(new PortHit(scope.id, "channels", "output"), new PortHit(cos.id, "downstream", "input"));
  expect(first?.from.vectorIndex).toBe(0);
  expect(second?.from.vectorIndex).toBe(1);
  expect(first?.to.vectorIndex).toBe(0);
  expect(second?.to.vectorIndex).toBe(0);
});

test("selects a block on click and moves it only after the pointer travels", () => {
  const selected: string[] = [];
  const moved: number[][] = [];
  const click = new BlockMoveGesture(gestureHost(selected, moved), "scope", pointer(4, 6));
  click.move(pointer(5, 6));
  click.finish();
  expect(selected).toEqual(["scope"]);
  expect(moved).toEqual([]);

  const drag = new BlockMoveGesture(gestureHost(selected, moved), "scope", pointer(0, 0));
  drag.move(pointer(30, 4));
  drag.finish();
  expect(selected).toEqual(["scope"]);
  expect(moved).toEqual([[40, 24]]);
});

function pointer(x: number, y: number): PointerEvent {
  return { clientX: x, clientY: y } as PointerEvent;
}

function gestureHost(selected: string[], moved: number[][]): DiagramGestureHost {
  return {
    canvasElement: () => undefined,
    armDefinition() {},
    armedDefinition: () => undefined,
    place() {},
    showGhost() {},
    setReceiving() {},
    moveBlock(_blockId, x, y) {
      moved.push([x, y]);
    },
    blockOrigin: () => new WirePoint(10, 20),
    setMoving() {},
    selectBlock(blockId) {
      selected.push(blockId);
    },
    connect() {},
    setDraft() {},
    anchor: () => undefined,
  };
}
