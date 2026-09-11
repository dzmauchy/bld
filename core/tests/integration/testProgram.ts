const GENERATED_PRELUDE = `import { DiscardF32, TestExecutionContext, dest1, dest2, dest3, gpioSinks, gpioSinks3, pins, widths } from "./harness";
import { const_f32, cos_f32, cos_gen_f32, gpio_in, product_f32, pulse_gen_f32, rand_gen_f32, scope_f32, sin_f32, sin_gen_f32 } from "./blocks";

const ec = new TestExecutionContext();
`;

const GENERATED_EXPORTS = `
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

/** Wrap a generated AssemblyScript snippet with the in-wasm test harness. */
export function wrapGenerated(body: string): string {
  return `${GENERATED_PRELUDE}\n${body}\n${GENERATED_EXPORTS}\n`;
}
