import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createNodeAsRuntime } from "../../src/as/runtime.node.ts";
import { Diagram, PortEndpoint } from "../../src/model/index.ts";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const assemblyDir = join(coreRoot, "assets/assembly");

const runtime = createNodeAsRuntime(assemblyDir);

afterAll(async () => {
  await runtime.close();
});

describe("Diagram compiling to WASM and execution", () => {
  test("runs const_f32 to scope_f32 via wasm", async () => {
    const diagram = new Diagram("test_const", "Const to Scope");
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 }, "scope_0", {
      precision: 10,
    });
    const constant = diagram.addBlock("const_f32", { x: 100, y: 10 }, "const_0", {
      precision: 10,
      v: 5.5,
    });

    diagram.connect(
      new PortEndpoint(constant.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );

    const session = await diagram.run(runtime);
    try {
      await session.tickThenObserve();
      expect(await session.lastPin(0, 0)).toBe(5.5);
    } finally {
      await session.close();
    }
  });

  test("runs cos_gen_f32 to scope_f32 via wasm", async () => {
    const diagram = new Diagram("test_cos", "Cos Gen to Scope");
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 }, "scope_0", {
      precision: 10,
    });
    const cosGen = diagram.addBlock("cos_gen_f32", { x: 100, y: 10 }, "cos_gen_0", {
      precision: 10,
    });

    diagram.connect(
      new PortEndpoint(cosGen.id, "input", "v", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );

    const session = await diagram.run(runtime);
    try {
      await session.setNow(0);
      await session.tickThenObserve();
      expect(await session.lastPin(0, 0)).toBeCloseTo(1, 5);
    } finally {
      await session.close();
    }
  });

  test("runs product_f32 of two constants to scope_f32 via wasm", async () => {
    const diagram = new Diagram("test_product", "Product to Scope");
    const scope = diagram.addBlock("scope_f32", { x: 10, y: 10 }, "scope_0");
    const product = diagram.addBlock("product_f32", { x: 50, y: 10 }, "product_0");
    const constA = diagram.addBlock("const_f32", { x: 150, y: 10 }, "const_a", {
      precision: 10,
      v: 3.0,
    });
    const constB = diagram.addBlock("const_f32", { x: 150, y: 50 }, "const_b", {
      precision: 10,
      v: 4.0,
    });

    // Connect product output to scope
    diagram.connect(
      new PortEndpoint(product.id, "output", "p", 0),
      new PortEndpoint(scope.id, "output", "sink", 0),
    );

    // Connect constA to product input factor 0
    diagram.connect(
      new PortEndpoint(constA.id, "input", "v", 0),
      new PortEndpoint(product.id, "input", "v", 0),
    );

    // Connect constB to product input factor 1
    diagram.connect(
      new PortEndpoint(constB.id, "input", "v", 0),
      new PortEndpoint(product.id, "input", "v", 1),
    );

    const session = await diagram.run(runtime);
    try {
      await session.tickThenObserve();
      expect(await session.lastPin(0, 0)).toBe(12);
      expect(await session.lastPin(1, 0)).toBe(3);
      expect(await session.lastPin(1, 1)).toBe(4);
    } finally {
      await session.close();
    }
  });
});
