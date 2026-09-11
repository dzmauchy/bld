export interface Pss<T> {
  push(value: T): void;
}

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

export class Block {
  blockId: u32;
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
