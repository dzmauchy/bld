/**
 * Types corresponding to `core/assets/types.json`.
 *
 * Primitive keys in that catalog (`bool`, `i8`, `u8`, `i16`, `u16`, `i32`,
 * `u32`, `i64`, `u64`, `f32`, `f64`) are AssemblyScript builtins and are used
 * directly throughout this package.
 *
 * `pss` is a push stream: an object with a `push` method.
 * `array` is a managed `Array<T>`.
 */

/** Push stream (`pss` in types.json). */
export interface Pss<T> {
  push(value: T): void;
}

/**
 * Host / runtime services used by blocks. Tests provide a fake implementation;
 * MCU and browser hosts provide the production one.
 *
 * Callbacks are classes rather than closures because AssemblyScript cannot
 * capture locals in nested functions.
 */

export interface IntervalHandler {
  onInterval(): void;
}

export interface CloseHandler {
  onClose(): void;
}

export interface GpioInHandler {
  onGpioIn(pinIndex: u8, value: bool): void;
}

export abstract class ExecutionContext {
  abstract setInterval(period: u32, handler: IntervalHandler): u32;
  abstract clearInterval(id: u32): void;
  abstract onClose(handler: CloseHandler): void;
  abstract sendPinF32(blockId: u32, pin: u8, v: f32): void;
  abstract cos(v: f32): f32;
  abstract sin(v: f32): f32;
  abstract tan(v: f32): f32;
  abstract random(): f32;
  abstract now(): u64;
  abstract listenGpioIn(blockId: u32, handler: GpioInHandler): void;
  abstract unlistenGpioIn(blockId: u32): void;
}

/** Base class for every block in `blocks.json`. */
export class Block {
  blockId: u32;
  /** Port width, one entry per apply() port. */
  outputWidths: Uint8Array;
  ec: ExecutionContext;

  constructor(blockId: u32, outputWidths: Uint8Array, ec: ExecutionContext) {
    this.blockId = blockId;
    this.outputWidths = outputWidths;
    this.ec = ec;
  }

  static pushAll(streams: Array<Pss<f32>>, value: f32): void {
    for (let i = 0; i < streams.length; i++) {
      streams[i].push(value);
    }
  }

  static outputCountOf(widths: Uint8Array): i32 {
    return widths.length > 0 ? i32(widths[0]) : 0;
  }
}
