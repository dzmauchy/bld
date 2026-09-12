import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type CompilerContext,
  DiagramCompiler,
  registerCompilerContext,
} from "../src/model/compiler.ts";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const harnessPath = join(coreRoot, "tests/assembly/harness.ts");
const harnessSource = readFileSync(harnessPath, "utf8");

export const testContext: CompilerContext = {
  name: "test",
  getFiles() {
    return { "harness.ts": harnessSource };
  },
  getPrelude() {
    return `import { Block, DiscardF32, dest1, dest2, dest3, gpioSinks, gpioSinks3, pins, widths } from "./context";
import { const_f32, cos_f32, cos_gen_f32, gpio_in, product_f32, pulse_gen_f32, rand_gen_f32, scope_f32, sin_f32, sin_gen_f32 } from "./blocks";
import { TestExecutionContext } from "./harness";

const ec = new TestExecutionContext();
`;
  },
  getExports() {
    return `
export function tick(): void { ec.tick(); }
export function setNow(ms: u32): void { ec.setNow(u64(ms)); }
export function setRandom(value: f32): void { ec.setRandom(value); }
export function emitGpioIn(blockId: u32, pinIndex: u8, value: i32): void {
  ec.emitGpioIn(blockId, pinIndex, value != 0);
}
export function close(): void { ec.close(); }
export function clearPins(): void { ec.clearPins(); }
export function lastPin(blockId: u32, pin: u8): f32 { return ec.lastPin(blockId, pin); }
export function hasPin(blockId: u32, pin: u8): i32 { return ec.hasPin(blockId, pin) ? 1 : 0; }
export function pinWriteCount(): i32 { return ec.pinWriteCount(); }
export function activeIntervalCount(): i32 { return ec.activeIntervalCount(); }
export function intervalPeriodAt(index: i32): u32 { return ec.intervalPeriodAt(index); }
export function activeGpioListenerCount(): i32 { return ec.activeGpioListenerCount(); }
export function tickThenObserve(): void { ec.tickThenObserve(); }
`;
  },
};

registerCompilerContext(testContext);

export class TestCompiler extends DiagramCompiler {
  constructor(initialFiles?: Record<string, string>) {
    super(testContext, initialFiles);
  }
}
