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
