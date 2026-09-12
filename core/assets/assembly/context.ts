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

export class DiscardF32 implements Pss<f32> {
  push(_value: f32): void {}
}

export function widths(n: u8): Uint8Array {
  const w = new Uint8Array(1);
  w[0] = n;
  return w;
}

export function pins(a: u8, b: i32 = -1, c: i32 = -1): Uint8Array {
  let count = 1;
  if (b >= 0) count++;
  if (c >= 0) count++;
  const p = new Uint8Array(count);
  p[0] = a;
  if (b >= 0) p[1] = u8(b);
  if (c >= 0) p[2] = u8(c);
  return p;
}

export function dest1(a: Pss<f32>): Array<Pss<f32>> {
  const streams = new Array<Pss<f32>>(1);
  streams[0] = a;
  return streams;
}

export function dest2(a: Pss<f32>, b: Pss<f32>): Array<Pss<f32>> {
  const streams = new Array<Pss<f32>>(2);
  streams[0] = a;
  streams[1] = b;
  return streams;
}

export function dest3(a: Pss<f32>, b: Pss<f32>, c: Pss<f32>): Array<Pss<f32>> {
  const streams = new Array<Pss<f32>>(3);
  streams[0] = a;
  streams[1] = b;
  streams[2] = c;
  return streams;
}

export function gpioSinks(p0: Array<Pss<f32>>): Array<Array<Pss<f32>>> {
  const pinStreams = new Array<Array<Pss<f32>>>(1);
  pinStreams[0] = p0;
  return pinStreams;
}

export function gpioSinks3(
  p0: Array<Pss<f32>>,
  p1: Array<Pss<f32>>,
  p2: Array<Pss<f32>>
): Array<Array<Pss<f32>>> {
  const pinStreams = new Array<Array<Pss<f32>>>(3);
  pinStreams[0] = p0;
  pinStreams[1] = p1;
  pinStreams[2] = p2;
  return pinStreams;
}
