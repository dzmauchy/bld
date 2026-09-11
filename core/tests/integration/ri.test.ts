import { describe, expect, test } from "vitest";
import { RiExecutionContext, RiProgram } from "../../src/ri";

describe("RI Program Integration Tests (Connecting blocks in a program)", () => {
  describe("Linear Pipelines", () => {
    test("const_f32 -> scope_f32 connects and propagates value", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("c", "const_f32", { v: 42.5 })
        .connect(
          { blockId: "c", portId: "v", vectorIndex: 0 },
          { blockId: "s", portId: "sink", vectorIndex: 0 },
        )
        .start();

      expect(program.lastPin("s", 0)).toBe(42.5);
      expect(program.hasPin("s", 0)).toBe(true);
    });

    test("const_f32 -> cos_f32 -> scope_f32 connects and transforms cos(0) = 1.0", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("cos", "cos_f32")
        .addBlock("c", "const_f32", { v: 0 })
        .connect(
          { blockId: "c", portId: "v", vectorIndex: 0 },
          { blockId: "cos", portId: "v", vectorIndex: 0 },
        )
        .connect(
          { blockId: "cos", portId: "cos", vectorIndex: 0 },
          { blockId: "s", portId: "sink", vectorIndex: 0 },
        )
        .start();

      expect(program.lastPin("s", 0)).toBe(1.0);
    });

    test("const_f32 -> sin_f32 -> scope_f32 connects and transforms sin(0) = 0.0", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("sin", "sin_f32")
        .addBlock("c", "const_f32", { v: 0 })
        .connect(
          { blockId: "c", portId: "v", vectorIndex: 0 },
          { blockId: "sin", portId: "v", vectorIndex: 0 },
        )
        .connect(
          { blockId: "sin", portId: "sin", vectorIndex: 0 },
          { blockId: "s", portId: "sink", vectorIndex: 0 },
        )
        .start();

      expect(program.lastPin("s", 0)).toBe(0.0);
    });
  });

  describe("Multi-Input Arithmetic Pipelines", () => {
    test("two consts -> product_f32 -> scope_f32: 3.5 * 4 = 14", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("p", "product_f32", { precision: 10 })
        .addBlock("c1", "const_f32", { v: 3.5 })
        .addBlock("c2", "const_f32", { v: 4.0 })
        .connect(
          { blockId: "c1", portId: "v", vectorIndex: 0 },
          { blockId: "p", portId: "v", vectorIndex: 0 },
        )
        .connect(
          { blockId: "c2", portId: "v", vectorIndex: 0 },
          { blockId: "p", portId: "v", vectorIndex: 1 },
        )
        .connect(
          { blockId: "p", portId: "p", vectorIndex: 0 },
          { blockId: "s", portId: "sink", vectorIndex: 0 },
        )
        .start();

      program.tick(10);
      expect(program.lastPin("s", 0)).toBe(14.0);
    });

    test("three consts -> sum_f32 -> scope_f32: 10 + 20 + 35 = 65", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("sum", "sum_f32", { precision: 10 })
        .addBlock("c1", "const_f32", { v: 10 })
        .addBlock("c2", "const_f32", { v: 20 })
        .addBlock("c3", "const_f32", { v: 35 })
        .connect(
          { blockId: "c1", portId: "v", vectorIndex: 0 },
          { blockId: "sum", portId: "v", vectorIndex: 0 },
        )
        .connect(
          { blockId: "c2", portId: "v", vectorIndex: 0 },
          { blockId: "sum", portId: "v", vectorIndex: 1 },
        )
        .connect(
          { blockId: "c3", portId: "v", vectorIndex: 0 },
          { blockId: "sum", portId: "v", vectorIndex: 2 },
        )
        .connect(
          { blockId: "sum", portId: "s", vectorIndex: 0 },
          { blockId: "s", portId: "sink", vectorIndex: 0 },
        )
        .start();

      program.tick(10);
      expect(program.lastPin("s", 0)).toBe(65.0);
    });

    test("cascaded operations: (c1 * c2) + (c3 * c4) -> scope: (2 * 3) + (4 * 5) = 26", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("sum", "sum_f32", { precision: 10 })
        .addBlock("p1", "product_f32", { precision: 10 })
        .addBlock("p2", "product_f32", { precision: 10 })
        .addBlock("c1", "const_f32", { v: 2 })
        .addBlock("c2", "const_f32", { v: 3 })
        .addBlock("c3", "const_f32", { v: 4 })
        .addBlock("c4", "const_f32", { v: 5 })
        .connect({ blockId: "c1", portId: "v", vectorIndex: 0 }, { blockId: "p1", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "c2", portId: "v", vectorIndex: 0 }, { blockId: "p1", portId: "v", vectorIndex: 1 })
        .connect({ blockId: "c3", portId: "v", vectorIndex: 0 }, { blockId: "p2", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "c4", portId: "v", vectorIndex: 0 }, { blockId: "p2", portId: "v", vectorIndex: 1 })
        .connect({ blockId: "p1", portId: "p", vectorIndex: 0 }, { blockId: "sum", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "p2", portId: "p", vectorIndex: 0 }, { blockId: "sum", portId: "v", vectorIndex: 1 })
        .connect({ blockId: "sum", portId: "s", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 0 })
        .start();

      // First tick computes p1 and p2, second tick computes sum
      program.tick(10);
      program.tick(10);
      expect(program.lastPin("s", 0)).toBe(26.0);
    });
  });

  describe("Chaining, Fan-out & Diamond Topologies", () => {
    test("deep chaining: const(0) -> cos -> sin -> cos -> scope", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("c1", "cos_f32")
        .addBlock("sn", "sin_f32")
        .addBlock("c2", "cos_f32")
        .addBlock("zero", "const_f32", { v: 0 })
        .connect({ blockId: "zero", portId: "v", vectorIndex: 0 }, { blockId: "c1", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "c1", portId: "cos", vectorIndex: 0 }, { blockId: "sn", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "sn", portId: "sin", vectorIndex: 0 }, { blockId: "c2", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "c2", portId: "cos", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 0 })
        .start();

      // cos(0) = 1 -> sin(1) -> cos(sin(1))
      const expected = Math.cos(Math.sin(1.0));
      expect(program.lastPin("s", 0)).toBeCloseTo(expected, 5);
    });

    test("fan-out: single const fans out to 3 channels of same scope", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("c", "const_f32", { v: 99.5 })
        .connect({ blockId: "c", portId: "v", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 0 })
        .connect({ blockId: "c", portId: "v", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 1 })
        .connect({ blockId: "c", portId: "v", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 2 })
        .start();

      expect(program.lastPin("s", 0)).toBe(99.5);
      expect(program.lastPin("s", 1)).toBe(99.5);
      expect(program.lastPin("s", 2)).toBe(99.5);
    });

    test("self-squaring: single const connects to both inputs of product (x * x)", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("p", "product_f32", { precision: 10 })
        .addBlock("c", "const_f32", { v: 7 })
        .connect({ blockId: "c", portId: "v", vectorIndex: 0 }, { blockId: "p", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "c", portId: "v", vectorIndex: 0 }, { blockId: "p", portId: "v", vectorIndex: 1 })
        .connect({ blockId: "p", portId: "p", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 0 })
        .start();

      program.tick(10);
      expect(program.lastPin("s", 0)).toBe(49.0);
    });

    test("diamond graph: const(0.5) splits to cos and sin, converging into product", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("p", "product_f32", { precision: 10 })
        .addBlock("cos", "cos_f32")
        .addBlock("sin", "sin_f32")
        .addBlock("c", "const_f32", { v: 0.5 })
        .connect({ blockId: "c", portId: "v", vectorIndex: 0 }, { blockId: "cos", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "c", portId: "v", vectorIndex: 0 }, { blockId: "sin", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "cos", portId: "cos", vectorIndex: 0 }, { blockId: "p", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "sin", portId: "sin", vectorIndex: 0 }, { blockId: "p", portId: "v", vectorIndex: 1 })
        .connect({ blockId: "p", portId: "p", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 0 })
        .start();

      program.tick(10);
      const expected = Math.cos(0.5) * Math.sin(0.5);
      expect(program.lastPin("s", 0)).toBeCloseTo(expected, 4);
    });
  });

  describe("External Events & Signal Generators", () => {
    test("gpio_in_f32 pushes pin events to scope", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("g", "gpio_in", { port: 0, pins: [0, 4] })
        .connect({ blockId: "g", portId: "pin", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 0 })
        .connect({ blockId: "g", portId: "pin", vectorIndex: 1 }, { blockId: "s", portId: "sink", vectorIndex: 1 })
        .start();

      expect(program.hasPin("s", 0)).toBe(false);

      // Trigger pin 0 with true (1)
      program.emitGpio(0, 0, true);
      expect(program.lastPin("s", 0)).toBe(1.0);
      expect(program.hasPin("s", 1)).toBe(false);

      // Trigger pin 4 with true (1)
      program.emitGpio(0, 4, true);
      expect(program.lastPin("s", 1)).toBe(1.0);
    });

    test("cos_gen_f32 across time steps to scope", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("gen", "cos_gen_f32", { precision: 10, frequency: 1, amplitude: 1, phase: 0 })
        .connect({ blockId: "gen", portId: "v", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 0 })
        .start();

      // t = 0 -> cos(0) = 1.0
      program.setNow(0);
      program.tick(0);
      expect(program.lastPin("s", 0)).toBeCloseTo(1.0, 4);

      // t = 500ms -> cos(pi) = -1.0
      program.setNow(500);
      program.tick(0);
      expect(program.lastPin("s", 0)).toBeCloseTo(-1.0, 4);
    });

    test("pulse-gated waveform: pulse_gen * sin_gen -> product -> scope", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("p", "product_f32", { precision: 1 })
        .addBlock("pulse", "pulse_gen_f32", { duty_cycle: 0.5, amplitude: 1, frequency: 1 })
        .addBlock("sin", "sin_gen_f32", { precision: 1, frequency: 1, amplitude: 2 })
        .connect({ blockId: "pulse", portId: "v", vectorIndex: 0 }, { blockId: "p", portId: "v", vectorIndex: 0 })
        .connect({ blockId: "sin", portId: "v", vectorIndex: 0 }, { blockId: "p", portId: "v", vectorIndex: 1 })
        .connect({ blockId: "p", portId: "p", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 0 })
        .start();

      // t = 250ms: pulse is HIGH (1), sin(250ms = pi/2) is 2 -> product = 2
      program.setNow(250);
      program.tick(0); // pulse and sin produce values
      program.tick(0); // product computes
      expect(program.lastPin("s", 0)).toBeCloseTo(2.0, 3);

      // t = 750ms: pulse is LOW (0) -> product = 0
      program.setNow(750);
      program.tick(0);
      program.tick(0);
      expect(program.lastPin("s", 0)).toBeCloseTo(0.0, 3);
    });
  });

  describe("Lifecycle and Diagram JSON loading", () => {
    test("close terminates active intervals and stops updates", () => {
      const ctx = new RiExecutionContext();
      const program = new RiProgram(ctx);

      program
        .addBlock("s", "scope_f32")
        .addBlock("gen", "cos_gen_f32", { precision: 10 })
        .connect({ blockId: "gen", portId: "v", vectorIndex: 0 }, { blockId: "s", portId: "sink", vectorIndex: 0 })
        .start();

      expect(ctx.activeIntervalCount()).toBe(1);
      program.close();
      expect(ctx.activeIntervalCount()).toBe(0);
      expect(ctx.isClosed()).toBe(true);
    });

    test("RiProgram.fromDiagramJson creates and runs connected program", () => {
      const diagramJson = {
        blocks: {
          s: { ref: "scope_f32" },
          p: { ref: "product_f32", conf: { precision: 10 } },
          a: { ref: "const_f32", conf: { v: 6 } },
          b: { ref: "const_f32", conf: { v: 7 } },
        },
        connections: {
          a__p: {
            from: { block: "a", port: { id: "v", vector_index: 0 } },
            to: { block: "p", port: { id: "v", vector_index: 0 } },
          },
          b__p: {
            from: { block: "b", port: { id: "v", vector_index: 0 } },
            to: { block: "p", port: { id: "v", vector_index: 1 } },
          },
          p__s: {
            from: { block: "p", port: { id: "p", vector_index: 0 } },
            to: { block: "s", port: { id: "sink", vector_index: 0 } },
          },
        },
      };

      const program = RiProgram.fromDiagramJson(diagramJson);
      program.start();
      program.tick(10);
      expect(program.lastPin("s", 0)).toBe(42.0);
    });
  });
});
