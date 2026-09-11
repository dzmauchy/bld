import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createNodeAsRuntime } from "../../src/as/runtime.node.ts";
import { wrapGenerated } from "./testProgram.ts";
import type { AsSession } from "../../src/as/runtime.ts";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const assemblyDir = join(coreRoot, "assets/assembly");
const blocksPath = join(coreRoot, "assets/blocks.json");
const typesPath = join(coreRoot, "assets/types.json");

function assemblySources(): string {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, name.name);
      if (name.isDirectory()) {
        if (name.name === "build") continue;
        walk(path);
      } else if (name.name.endsWith(".ts")) {
        files.push(readFileSync(path, "utf8"));
      }
    }
  };
  walk(assemblyDir);
  return files.join("\n");
}

describe("assemblyscript assets match catalog", () => {
  test("every blocks.json entry has a class", () => {
    const catalog = JSON.parse(readFileSync(blocksPath, "utf8")) as Record<string, unknown>;
    const ids = Object.keys(catalog).filter((key) => key !== "$schema");
    const source = assemblySources();
    for (const id of ids) {
      expect(source, id).toContain(`class ${id} `);
    }
  });

  test("types.json primitives are AssemblyScript builtins or aliases", () => {
    const catalog = JSON.parse(readFileSync(typesPath, "utf8")) as Record<string, unknown>;
    const ids = Object.keys(catalog).filter((key) => key !== "$schema");
    expect(ids).toEqual(
      expect.arrayContaining([
        "bool",
        "i8",
        "u8",
        "i16",
        "u16",
        "i32",
        "u32",
        "i64",
        "u64",
        "f32",
        "f64",
        "pss",
        "array",
      ]),
    );
    const contextSource = readFileSync(join(assemblyDir, "context.ts"), "utf8");
    expect(contextSource).toContain("export interface Pss<T>");
  });
});

const runtime = createNodeAsRuntime(assemblyDir);

beforeAll(async () => {
  // Warm the workers with an empty program so the first test is not special.
  await runtime.createSession(wrapGenerated(""));
});

afterAll(async () => {
  await runtime.close();
});

async function session(body: string): Promise<AsSession> {
  return runtime.createSession(wrapGenerated(body));
}

describe("generated assemblyscript pin programs", () => {
  test("Block.outputCountOf reads the first width", async () => {
    const rt = await session(`
      export function empty(): i32 { return Block.outputCountOf(new Uint8Array(0)); }
      export function counted(): i32 { return Block.outputCountOf(widths(4)); }
    `);
    expect(await rt.call("empty")).toBe(0);
    expect(await rt.call("counted")).toBe(4);
  });

  test("Block.pushAll writes to every stream", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(2), ec);
      const sinks = scope.apply();
      Block.pushAll(sinks, 2.5);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(2.5);
    expect(await rt.lastPin(0, 1)).toBe(2.5);
  });

  test("const_f32 pushes value to scope", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec, 60, 10);
      const sinks = scope.apply();
      new const_f32(1, widths(1), ec, 10, 3.5).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(3.5);
  });

  test("const_f32 zero to scope", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new const_f32(1, widths(1), ec, 10, 0.0).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
  });

  test("const_f32 negative to scope", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new const_f32(1, widths(1), ec, 10, -2.25).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(-2.25);
  });

  test("const_f32 fans out to two scope channels", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(2), ec, 60, 10);
      const sinks = scope.apply();
      new const_f32(1, widths(1), ec, 10, 8.0).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(8);
    expect(await rt.lastPin(0, 1)).toBe(8);
  });

  test("const_f32 default precision is ten", async () => {
    const rt = await session(`
      const constant = new const_f32(1, widths(1), ec);
      constant.apply(dest1(new DiscardF32()));
      export function precision(): u32 { return constant.precision; }
    `);
    expect(await rt.call("precision")).toBe(10);
    expect(await rt.intervalPeriodAt(0)).toBe(10);
  });

  test("const_f32 uses configured precision", async () => {
    const rt = await session(`
      const constant = new const_f32(1, widths(1), ec, 25, 1.0);
      constant.apply(dest1(new DiscardF32()));
    `);
    expect(await rt.intervalPeriodAt(0)).toBe(25);
  });

  test("const_f32 on close stops pushing", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new const_f32(1, widths(1), ec, 10, 9.0).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(9);
    await rt.close();
    expect(await rt.activeIntervalCount()).toBe(0);
    await rt.clearPins();
    await rt.tick();
    expect(await rt.hasPin(0, 0)).toBe(false);
  });

  test("product_f32 two constants", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(2), ec);
      const factors = product.apply(sinks);
      new const_f32(2, widths(1), ec, 10, 3.0).apply(dest1(factors[0]));
      new const_f32(3, widths(1), ec, 10, 4.0).apply(dest1(factors[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(12);
    expect(await rt.lastPin(1, 0)).toBe(3);
    expect(await rt.lastPin(1, 1)).toBe(4);
  });

  test("product_f32 three constants", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(3), ec);
      const factors = product.apply(sinks);
      new const_f32(2, widths(1), ec, 10, 2.0).apply(dest1(factors[0]));
      new const_f32(3, widths(1), ec, 10, 3.0).apply(dest1(factors[1]));
      new const_f32(4, widths(1), ec, 10, 5.0).apply(dest1(factors[2]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(30);
    expect(await rt.lastPin(1, 0)).toBe(2);
    expect(await rt.lastPin(1, 1)).toBe(3);
    expect(await rt.lastPin(1, 2)).toBe(5);
  });

  test("product_f32 single factor is identity", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(1), ec);
      const factors = product.apply(sinks);
      new const_f32(2, widths(1), ec, 10, 7.5).apply(factors);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(7.5);
    expect(await rt.lastPin(1, 0)).toBe(7.5);
  });

  test("product_f32 unset factor defaults to one", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(2), ec);
      const factors = product.apply(sinks);
      new const_f32(2, widths(1), ec, 10, 6.0).apply(dest1(factors[0]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(6);
    expect(await rt.lastPin(1, 0)).toBe(6);
  });

  test("product_f32 fans out to two scopes", async () => {
    const rt = await session(`
      const left = new scope_f32(0, widths(1), ec);
      const right = new scope_f32(1, widths(1), ec);
      const product = new product_f32(2, widths(2), ec);
      const factors = product.apply(dest2(left.apply()[0], right.apply()[0]));
      new const_f32(3, widths(1), ec, 10, 2.0).apply(dest1(factors[0]));
      new const_f32(4, widths(1), ec, 10, 9.0).apply(dest1(factors[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(18);
    expect(await rt.lastPin(1, 0)).toBe(18);
  });

  test("product_f32 zero factor zeroes result", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(2), ec);
      const factors = product.apply(sinks);
      new const_f32(2, widths(1), ec, 10, 0.0).apply(dest1(factors[0]));
      new const_f32(3, widths(1), ec, 10, 11.0).apply(dest1(factors[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
  });

  test("product_f32 negative factors", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(2), ec);
      const factors = product.apply(sinks);
      new const_f32(2, widths(1), ec, 10, -2.0).apply(dest1(factors[0]));
      new const_f32(3, widths(1), ec, 10, 5.0).apply(dest1(factors[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(-10);
  });

  test("cos_f32 of zero is one", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const cos = new cos_f32(1, widths(1), ec);
      const input = cos.apply(sinks);
      new const_f32(2, widths(1), ec, 10, 0.0).apply(dest1(input));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    expect(await rt.lastPin(1, 0)).toBe(1);
  });

  test("cos_f32 of pi is minus one", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const cos = new cos_f32(1, widths(1), ec);
      const input = cos.apply(sinks);
      new const_f32(2, widths(1), ec, 10, Mathf.PI).apply(dest1(input));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(1, 0)).toBeCloseTo(-1, 5);
    expect(await rt.lastPin(0, 0)).toBeCloseTo(-1, 5);
  });

  test("sin_f32 of zero is zero", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const sin = new sin_f32(1, widths(1), ec);
      const input = sin.apply(sinks);
      new const_f32(2, widths(1), ec, 10, 0.0).apply(dest1(input));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
    expect(await rt.lastPin(1, 0)).toBe(0);
  });

  test("sin_f32 of half pi is one", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const sin = new sin_f32(1, widths(1), ec);
      const input = sin.apply(sinks);
      new const_f32(2, widths(1), ec, 10, Mathf.PI * 0.5).apply(dest1(input));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(1, 0)).toBeCloseTo(1, 5);
    expect(await rt.lastPin(0, 0)).toBeCloseTo(1, 5);
  });

  test("sin_f32 of pi is zero", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const sin = new sin_f32(1, widths(1), ec);
      const input = sin.apply(sinks);
      new const_f32(2, widths(1), ec, 10, Mathf.PI).apply(dest1(input));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(1, 0)).toBeCloseTo(0, 5);
  });

  test("const cos sin chain", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const sin = new sin_f32(1, widths(1), ec);
      const sinIn = sin.apply(sinks);
      const cos = new cos_f32(2, widths(1), ec);
      const cosIn = cos.apply(dest1(sinIn));
      new const_f32(3, widths(1), ec, 10, 0.0).apply(dest1(cosIn));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(2, 0)).toBe(1);
    expect(await rt.lastPin(1, 0)).toBeCloseTo(Math.sin(1), 5);
    expect(await rt.lastPin(0, 0)).toBeCloseTo(Math.sin(1), 5);
  });

  test("cos_f32 fans out to two scope channels", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(2), ec);
      const sinks = scope.apply();
      const cos = new cos_f32(1, widths(1), ec);
      const input = cos.apply(sinks);
      new const_f32(2, widths(1), ec, 10, 0.0).apply(dest1(input));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    expect(await rt.lastPin(0, 1)).toBe(1);
  });

  test("product then cos", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const cos = new cos_f32(1, widths(1), ec);
      const cosIn = cos.apply(sinks);
      const product = new product_f32(2, widths(2), ec);
      const factors = product.apply(dest1(cosIn));
      new const_f32(3, widths(1), ec, 10, 0.0).apply(dest1(factors[0]));
      new const_f32(4, widths(1), ec, 10, 0.0).apply(dest1(factors[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(1, 0)).toBe(1);
    expect(await rt.lastPin(0, 0)).toBe(1);
  });

  test("scope_f32 reports nan before any push", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(2), ec, 60, 10);
      scope.apply();
    `);
    await rt.tick();
    expect(Number.isNaN(await rt.lastPin(0, 0))).toBe(true);
    expect(Number.isNaN(await rt.lastPin(0, 1))).toBe(true);
  });

  test("scope_f32 channels are independent", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(2), ec);
      const sinks = scope.apply();
      new const_f32(1, widths(1), ec, 10, 1.5).apply(dest1(sinks[0]));
      new const_f32(2, widths(1), ec, 10, 9.5).apply(dest1(sinks[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1.5);
    expect(await rt.lastPin(0, 1)).toBe(9.5);
  });

  test("scope_f32 keeps latest value", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const constant = new const_f32(1, widths(1), ec, 10, 1.0);
      constant.apply(sinks);
      export function setConstV(v: f32): void { constant.v = v; }
    `);
    await rt.tick();
    await rt.call("setConstV", 4);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(4);
  });

  test("scope_f32 default conf", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      export function period(): u32 { return scope.period; }
      export function precision(): u32 { return scope.precision; }
      scope.apply();
    `);
    expect(await rt.call("period")).toBe(60);
    expect(await rt.call("precision")).toBe(10);
    expect(await rt.intervalPeriodAt(0)).toBe(10);
  });

  test("scope_f32 custom precision", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec, 30, 11);
      export function period(): u32 { return scope.period; }
      export function precision(): u32 { return scope.precision; }
      scope.apply();
    `);
    expect(await rt.call("period")).toBe(30);
    expect(await rt.call("precision")).toBe(11);
    expect(await rt.intervalPeriodAt(0)).toBe(11);
  });

  test("scope_f32 three channels partial feed", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(3), ec);
      const sinks = scope.apply();
      new const_f32(1, widths(1), ec, 10, 2.0).apply(dest1(sinks[0]));
      new const_f32(2, widths(1), ec, 10, 3.0).apply(dest1(sinks[2]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(2);
    expect(Number.isNaN(await rt.lastPin(0, 1))).toBe(true);
    expect(await rt.lastPin(0, 2)).toBe(3);
  });

  test("scope_f32 on close stops sampling", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new const_f32(1, widths(1), ec, 10, 1.0).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    await rt.close();
    await rt.clearPins();
    await rt.tick();
    expect(await rt.hasPin(0, 0)).toBe(false);
  });

  test("cos_gen_f32 at zero is one", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new cos_gen_f32(1, widths(1), ec, 10).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
  });

  test("sin_gen_f32 at zero is zero", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new sin_gen_f32(1, widths(1), ec, 10).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
  });

  test("cos_gen_f32 at one second", async () => {
    const rt = await session(`
      ec.setNow(1000);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new cos_gen_f32(1, widths(1), ec, 10).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBeCloseTo(Math.cos(1), 5);
  });

  test("sin_gen_f32 at one second", async () => {
    const rt = await session(`
      ec.setNow(1000);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new sin_gen_f32(1, widths(1), ec, 10).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBeCloseTo(Math.sin(1), 5);
  });

  test("cos_gen through cos transformer", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const cos = new cos_f32(1, widths(1), ec);
      const input = cos.apply(sinks);
      new cos_gen_f32(2, widths(1), ec, 10).apply(dest1(input));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(1, 0)).toBeCloseTo(Math.cos(1), 5);
    expect(await rt.lastPin(0, 0)).toBeCloseTo(Math.cos(1), 5);
  });

  test("rand_gen_f32 uses context random", async () => {
    const rt = await session(`
      ec.setRandom(0.25);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new rand_gen_f32(1, widths(1), ec, 10).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0.25);
  });

  test("rand_gen_f32 tracks updated random", async () => {
    const rt = await session(`
      ec.setRandom(0.1);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new rand_gen_f32(1, widths(1), ec).apply(sinks);
    `);
    await rt.tick();
    await rt.setRandom(0.9);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBeCloseTo(0.9, 5);
  });

  test("generators fan out to two channels", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(2), ec);
      const sinks = scope.apply();
      new cos_gen_f32(1, widths(1), ec).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    expect(await rt.lastPin(0, 1)).toBe(1);
  });

  test("sin_gen and cos_gen to separate channels", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(2), ec);
      const sinks = scope.apply();
      new cos_gen_f32(1, widths(1), ec).apply(dest1(sinks[0]));
      new sin_gen_f32(2, widths(1), ec).apply(dest1(sinks[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    expect(await rt.lastPin(0, 1)).toBe(0);
  });

  test("generator on close stops", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new cos_gen_f32(1, widths(1), ec).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    await rt.close();
    await rt.clearPins();
    await rt.tick();
    expect(await rt.hasPin(0, 0)).toBe(false);
  });

  test("cos_gen default precision", async () => {
    const rt = await session(`
      const gen = new cos_gen_f32(1, widths(1), ec);
      gen.apply(dest1(new DiscardF32()));
      export function precision(): u32 { return gen.precision; }
    `);
    expect(await rt.call("precision")).toBe(10);
    expect(await rt.intervalPeriodAt(0)).toBe(10);
  });

  test("pulse_gen high at start of period", async () => {
    const rt = await session(`
      ec.setNow(0);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new pulse_gen_f32(1, widths(1), ec, 10, 0.5).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
  });

  test("pulse_gen low after duty window", async () => {
    const rt = await session(`
      ec.setNow(5);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new pulse_gen_f32(1, widths(1), ec, 10, 0.5).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
  });

  test("pulse_gen high just inside duty window", async () => {
    const rt = await session(`
      ec.setNow(4);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new pulse_gen_f32(1, widths(1), ec, 10, 0.5).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
  });

  test("pulse_gen wraps with period", async () => {
    const rt = await session(`
      ec.setNow(10);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new pulse_gen_f32(1, widths(1), ec, 10, 0.5).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
  });

  test("pulse_gen duty zero always low", async () => {
    const rt = await session(`
      ec.setNow(0);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new pulse_gen_f32(1, widths(1), ec, 10, 0.0).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
  });

  test("pulse_gen duty one always high", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new pulse_gen_f32(1, widths(1), ec, 10, 1.0).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    await rt.setNow(9);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
  });

  test("pulse_gen quarter duty", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      new pulse_gen_f32(1, widths(1), ec, 20, 0.25).apply(sinks);
    `);
    await rt.setNow(0);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    await rt.setNow(4);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    await rt.setNow(5);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
  });

  test("pulse_gen default conf", async () => {
    const rt = await session(`
      const pulse = new pulse_gen_f32(1, widths(1), ec);
      export function period(): u32 { return pulse.period; }
      export function duty(): f32 { return pulse.dutyCycle; }
    `);
    expect(await rt.call("period")).toBe(10);
    expect(await rt.call("duty")).toBe(0.5);
  });

  test("gpio_in true is one on scope", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const gpioIn = new gpio_in(1, widths(1), ec, pins(0));
      gpioIn.apply(gpioSinks(sinks));
    `);
    await rt.emitGpioIn(1, 0, true);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
  });

  test("gpio_in false is zero on scope", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const gpioIn = new gpio_in(1, widths(1), ec, pins(0));
      gpioIn.apply(gpioSinks(sinks));
    `);
    await rt.emitGpioIn(1, 0, false);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
  });

  test("gpio_in routes pins independently", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(3), ec);
      const sinks = scope.apply();
      const gpioIn = new gpio_in(1, widths(1), ec, pins(0, 1, 4));
      gpioIn.apply(gpioSinks3(dest1(sinks[0]), dest1(sinks[1]), dest1(sinks[2])));
    `);
    await rt.emitGpioIn(1, 0, true);
    await rt.emitGpioIn(1, 1, false);
    await rt.emitGpioIn(1, 2, true);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    expect(await rt.lastPin(0, 1)).toBe(0);
    expect(await rt.lastPin(0, 2)).toBe(1);
  });

  test("gpio_in fans out to product and scope", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(2), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(2), ec);
      const factors = product.apply(dest1(sinks[0]));
      new const_f32(2, widths(1), ec, 10, 5.0).apply(dest1(factors[0]));
      const gpioIn = new gpio_in(3, widths(1), ec, pins(0));
      gpioIn.apply(gpioSinks(dest2(factors[1], sinks[1])));
    `);
    await rt.emitGpioIn(3, 0, true);
    await rt.tick();
    expect(await rt.lastPin(1, 0)).toBe(5);
    expect(await rt.lastPin(1, 1)).toBe(1);
    await rt.clearPins();
    await rt.tick();
    expect(await rt.lastPin(0, 0)).toBe(5);
    expect(await rt.lastPin(0, 1)).toBe(1);
  });

  test("gpio_in ignores other block ids", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const gpioIn = new gpio_in(1, widths(1), ec, pins(0));
      gpioIn.apply(gpioSinks(sinks));
    `);
    await rt.emitGpioIn(99, 0, true);
    await rt.tick();
    expect(Number.isNaN(await rt.lastPin(0, 0))).toBe(true);
  });

  test("gpio_in on close stops listening", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const gpioIn = new gpio_in(1, widths(1), ec, pins(0));
      gpioIn.apply(gpioSinks(sinks));
    `);
    await rt.close();
    expect(await rt.activeGpioListenerCount()).toBe(0);
    await rt.emitGpioIn(1, 0, true);
    await rt.clearPins();
    await rt.tick();
    expect(await rt.hasPin(0, 0)).toBe(false);
  });

  test("gpio_in stores configured pins", async () => {
    const rt = await session(`
      const gpioIn = new gpio_in(1, widths(1), ec, pins(0, 1, 4));
      export function pinCount(): i32 { return gpioIn.pinNumbers.length; }
      export function pinAt(i: i32): u8 { return gpioIn.pinNumbers[i]; }
    `);
    expect(await rt.call("pinCount")).toBe(3);
    expect(await rt.call("pinAt", 0)).toBe(0);
    expect(await rt.call("pinAt", 1)).toBe(1);
    expect(await rt.call("pinAt", 2)).toBe(4);
  });

  test("demo diagram cos_gen to scope", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec, 30, 11);
      const sinks = scope.apply();
      new cos_gen_f32(1, widths(1), ec, 11).apply(sinks);
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
  });

  test("demo diagram cos times sin at zero", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec, 30, 11);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(2), ec);
      const factors = product.apply(sinks);
      new cos_gen_f32(2, widths(1), ec, 11).apply(dest1(factors[0]));
      new sin_gen_f32(3, widths(1), ec, 11).apply(dest1(factors[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(1, 0)).toBe(1);
    expect(await rt.lastPin(1, 1)).toBe(0);
    expect(await rt.lastPin(0, 0)).toBe(0);
  });

  test("demo diagram cos times sin at one second", async () => {
    const rt = await session(`
      ec.setNow(1000);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(2), ec);
      const factors = product.apply(sinks);
      new cos_gen_f32(2, widths(1), ec).apply(dest1(factors[0]));
      new sin_gen_f32(3, widths(1), ec).apply(dest1(factors[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(1, 0)).toBeCloseTo(Math.cos(1), 5);
    expect(await rt.lastPin(1, 1)).toBeCloseTo(Math.sin(1), 5);
    expect(await rt.lastPin(0, 0)).toBeCloseTo(Math.cos(1) * Math.sin(1), 5);
  });

  test("diagram const product cos scope", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const cos = new cos_f32(1, widths(1), ec);
      const cosIn = cos.apply(sinks);
      const product = new product_f32(2, widths(2), ec);
      const factors = product.apply(dest1(cosIn));
      new const_f32(3, widths(1), ec, 10, Mathf.PI).apply(dest1(factors[0]));
      new const_f32(4, widths(1), ec, 10, 1.0).apply(dest1(factors[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(2, 0)).toBeCloseTo(Math.PI, 5);
    expect(await rt.lastPin(2, 1)).toBe(1);
    expect(await rt.lastPin(1, 0)).toBeCloseTo(-1, 5);
    expect(await rt.lastPin(0, 0)).toBeCloseTo(-1, 5);
  });

  test("diagram gpio and const through product", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(2), ec);
      const factors = product.apply(sinks);
      new const_f32(2, widths(1), ec, 10, 4.0).apply(dest1(factors[0]));
      const gpioIn = new gpio_in(3, widths(1), ec, pins(0));
      gpioIn.apply(gpioSinks(dest1(factors[1])));
    `);
    await rt.emitGpioIn(3, 0, true);
    await rt.tick();
    expect(await rt.lastPin(1, 0)).toBe(4);
    expect(await rt.lastPin(1, 1)).toBe(1);
    await rt.clearPins();
    await rt.tick();
    expect(await rt.lastPin(0, 0)).toBe(4);
    await rt.emitGpioIn(3, 0, false);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
  });

  test("diagram pulse and const to two scope channels", async () => {
    const rt = await session(`
      ec.setNow(0);
      const scope = new scope_f32(0, widths(2), ec);
      const sinks = scope.apply();
      new pulse_gen_f32(1, widths(1), ec, 10, 0.5).apply(dest1(sinks[0]));
      new const_f32(2, widths(1), ec, 10, 3.0).apply(dest1(sinks[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    expect(await rt.lastPin(0, 1)).toBe(3);
    await rt.setNow(6);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(0);
    expect(await rt.lastPin(0, 1)).toBe(3);
  });

  test("diagram rand times const", async () => {
    const rt = await session(`
      ec.setRandom(0.5);
      const scope = new scope_f32(0, widths(1), ec);
      const sinks = scope.apply();
      const product = new product_f32(1, widths(2), ec);
      const factors = product.apply(sinks);
      new rand_gen_f32(2, widths(1), ec).apply(dest1(factors[0]));
      new const_f32(3, widths(1), ec, 10, 8.0).apply(dest1(factors[1]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(4);
  });

  test("diagram three channel scope from three sources", async () => {
    const rt = await session(`
      const scope = new scope_f32(0, widths(3), ec);
      const sinks = scope.apply();
      new const_f32(1, widths(1), ec, 10, 1.0).apply(dest1(sinks[0]));
      new sin_gen_f32(2, widths(1), ec).apply(dest1(sinks[1]));
      new cos_gen_f32(3, widths(1), ec).apply(dest1(sinks[2]));
    `);
    await rt.tickThenObserve();
    expect(await rt.lastPin(0, 0)).toBe(1);
    expect(await rt.lastPin(0, 1)).toBe(0);
    expect(await rt.lastPin(0, 2)).toBe(1);
  });
});
