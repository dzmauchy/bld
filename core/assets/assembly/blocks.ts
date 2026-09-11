import { Block, CloseHandler, ExecutionContext, GpioInHandler, IntervalHandler, Pss } from "./context";

function pushAll(streams: Array<Pss<f32>>, value: f32): void {
  for (let i = 0; i < streams.length; i++) {
    streams[i].push(value);
  }
}

function outputCountOf(widths: Uint8Array): i32 {
  return widths.length > 0 ? i32(widths[0]) : 0;
}

/**
 * `gpio_in` — source that fans each configured pin out to arrays of
 * `pss<f32>` streams. Incoming true/false becomes 1.0 / 0.0.
 */
export class gpio_in extends Block implements GpioInHandler, CloseHandler {
  pinNumbers: Uint8Array;
  streams: Array<Array<Pss<f32>>> = new Array<Array<Pss<f32>>>();

  constructor(
    blockId: u32,
    widths: Uint8Array,
    ec: ExecutionContext,
    pinNumbers: Uint8Array
  ) {
    super(blockId, widths, ec);
    this.pinNumbers = pinNumbers;
  }

  apply(streams: Array<Array<Pss<f32>>>): void {
    this.streams = streams;
    this.ec.listenGpioIn(this.blockId, this);
    this.ec.onClose(this);
  }

  onGpioIn(pinIndex: u8, value: bool): void {
    if (i32(pinIndex) >= this.streams.length) return;
    const v: f32 = value ? 1.0 : 0.0;
    const pinStreams = this.streams[i32(pinIndex)];
    for (let i = 0; i < pinStreams.length; i++) {
      pinStreams[i].push(v);
    }
  }

  onClose(): void {
    this.ec.unlistenGpioIn(this.blockId);
  }
}

/** Channel of `scope_f32` (JSON output `sink`). */
export class scope_f32_channel implements Pss<f32> {
  scope: scope_f32;
  index: i32;

  constructor(scope: scope_f32, index: i32) {
    this.scope = scope;
    this.index = index;
  }

  push(value: f32): void {
    this.scope.values[this.index] = value;
  }
}

/** Factor pin of `product_f32` (JSON output `p`). */
export class product_f32_factor implements Pss<f32> {
  product: product_f32;
  index: i32;

  constructor(product: product_f32, index: i32) {
    this.product = product;
    this.index = index;
  }

  push(value: f32): void {
    this.product.onFactor(this.index, value);
  }
}

/**
 * `scope_f32` — sink that samples connected streams on `precision` and
 * reports the latest value of each channel via `sendPinF32`.
 */
export class scope_f32 extends Block implements IntervalHandler, CloseHandler {
  period: u32;
  precision: u32;
  values: Array<f32> = new Array<f32>();
  timerId: u32 = 0;

  constructor(
    blockId: u32,
    widths: Uint8Array,
    ec: ExecutionContext,
    period: u32 = 60,
    precision: u32 = 10
  ) {
    super(blockId, widths, ec);
    this.period = period;
    this.precision = precision;
  }

  apply(): Array<Pss<f32>> {
    const outputCount = outputCountOf(this.outputWidths);
    this.values = new Array<f32>(outputCount);
    const streams = new Array<Pss<f32>>(outputCount);
    for (let i = 0; i < outputCount; i++) {
      this.values[i] = f32.NaN;
      streams[i] = new scope_f32_channel(this, i);
    }
    this.timerId = this.ec.setInterval(this.precision, this);
    this.ec.onClose(this);
    return streams;
  }

  onInterval(): void {
    for (let i = 0; i < this.values.length; i++) {
      this.ec.sendPinF32(this.blockId, u8(i), this.values[i]);
    }
  }

  onClose(): void {
    this.ec.clearInterval(this.timerId);
  }
}

/**
 * `product_f32` — multiplies the latest value of each factor pin (JSON
 * output `p`) and pushes the product to every downstream stream (JSON
 * input `v`). Unset factors start at 1 (multiplicative identity).
 */
export class product_f32 extends Block {
  values: Array<f32> = new Array<f32>();
  downstream: Array<Pss<f32>> = new Array<Pss<f32>>();

  constructor(blockId: u32, widths: Uint8Array, ec: ExecutionContext) {
    super(blockId, widths, ec);
  }

  apply(downstream: Array<Pss<f32>>): Array<Pss<f32>> {
    this.downstream = downstream;
    const factorCount = outputCountOf(this.outputWidths);
    this.values = new Array<f32>(factorCount);
    const factors = new Array<Pss<f32>>(factorCount);
    for (let i = 0; i < factorCount; i++) {
      this.values[i] = 1.0;
      factors[i] = new product_f32_factor(this, i);
    }
    return factors;
  }

  onFactor(index: i32, v: f32): void {
    this.values[index] = v;
    this.ec.sendPinF32(this.blockId, u8(index), v);
    let product: f32 = 1.0;
    for (let j = 0; j < this.values.length; j++) {
      product *= this.values[j];
    }
    pushAll(this.downstream, product);
  }
}

/**
 * `cos_f32` — cosine transformer. JSON input `v` is the downstream fan-out;
 * JSON output `cos` is the block itself as a push stream.
 */
export class cos_f32 extends Block implements Pss<f32> {
  downstream: Array<Pss<f32>> = new Array<Pss<f32>>();

  constructor(blockId: u32, widths: Uint8Array, ec: ExecutionContext) {
    super(blockId, widths, ec);
  }

  apply(downstream: Array<Pss<f32>>): cos_f32 {
    this.downstream = downstream;
    return this;
  }

  push(value: f32): void {
    const c = this.ec.cos(value);
    this.ec.sendPinF32(this.blockId, 0, c);
    pushAll(this.downstream, c);
  }
}

/**
 * `sin_f32` — sine transformer.
 */
export class sin_f32 extends Block implements Pss<f32> {
  downstream: Array<Pss<f32>> = new Array<Pss<f32>>();

  constructor(blockId: u32, widths: Uint8Array, ec: ExecutionContext) {
    super(blockId, widths, ec);
  }

  apply(downstream: Array<Pss<f32>>): sin_f32 {
    this.downstream = downstream;
    return this;
  }

  push(value: f32): void {
    const s = this.ec.sin(value);
    this.ec.sendPinF32(this.blockId, 0, s);
    pushAll(this.downstream, s);
  }
}

/**
 * `const_f32` — periodically pushes configuration value `v` to every
 * connected stream.
 */
export class const_f32 extends Block implements IntervalHandler, CloseHandler {
  precision: u32;
  v: f32;
  streams: Array<Pss<f32>> = new Array<Pss<f32>>();
  timerId: u32 = 0;

  constructor(
    blockId: u32,
    widths: Uint8Array,
    ec: ExecutionContext,
    precision: u32 = 10,
    v: f32 = 0.0
  ) {
    super(blockId, widths, ec);
    this.precision = precision;
    this.v = v;
  }

  apply(streams: Array<Pss<f32>>): void {
    this.streams = streams;
    this.timerId = this.ec.setInterval(this.precision, this);
    this.ec.onClose(this);
  }

  onInterval(): void {
    pushAll(this.streams, this.v);
  }

  onClose(): void {
    this.ec.clearInterval(this.timerId);
  }
}

/**
 * `cos_gen_f32` — cosine generator. Pushes `cos(now_ms / 1000)` on `precision`.
 */
export class cos_gen_f32 extends Block implements IntervalHandler, CloseHandler {
  precision: u32;
  streams: Array<Pss<f32>> = new Array<Pss<f32>>();
  timerId: u32 = 0;

  constructor(
    blockId: u32,
    widths: Uint8Array,
    ec: ExecutionContext,
    precision: u32 = 10
  ) {
    super(blockId, widths, ec);
    this.precision = precision;
  }

  apply(streams: Array<Pss<f32>>): void {
    this.streams = streams;
    this.timerId = this.ec.setInterval(this.precision, this);
    this.ec.onClose(this);
  }

  onInterval(): void {
    const t = f32(this.ec.now()) * 0.001;
    pushAll(this.streams, this.ec.cos(t));
  }

  onClose(): void {
    this.ec.clearInterval(this.timerId);
  }
}

/**
 * `sin_gen_f32` — sine generator. Pushes `sin(now_ms / 1000)` on `precision`.
 */
export class sin_gen_f32 extends Block implements IntervalHandler, CloseHandler {
  precision: u32;
  streams: Array<Pss<f32>> = new Array<Pss<f32>>();
  timerId: u32 = 0;

  constructor(
    blockId: u32,
    widths: Uint8Array,
    ec: ExecutionContext,
    precision: u32 = 10
  ) {
    super(blockId, widths, ec);
    this.precision = precision;
  }

  apply(streams: Array<Pss<f32>>): void {
    this.streams = streams;
    this.timerId = this.ec.setInterval(this.precision, this);
    this.ec.onClose(this);
  }

  onInterval(): void {
    const t = f32(this.ec.now()) * 0.001;
    pushAll(this.streams, this.ec.sin(t));
  }

  onClose(): void {
    this.ec.clearInterval(this.timerId);
  }
}

/**
 * `rand_gen_f32` — random generator. Pushes `random()` in `[0, 1)` on `precision`.
 */
export class rand_gen_f32 extends Block implements IntervalHandler, CloseHandler {
  precision: u32;
  streams: Array<Pss<f32>> = new Array<Pss<f32>>();
  timerId: u32 = 0;

  constructor(
    blockId: u32,
    widths: Uint8Array,
    ec: ExecutionContext,
    precision: u32 = 10
  ) {
    super(blockId, widths, ec);
    this.precision = precision;
  }

  apply(streams: Array<Pss<f32>>): void {
    this.streams = streams;
    this.timerId = this.ec.setInterval(this.precision, this);
    this.ec.onClose(this);
  }

  onInterval(): void {
    pushAll(this.streams, this.ec.random());
  }

  onClose(): void {
    this.ec.clearInterval(this.timerId);
  }
}

/**
 * `pulse_gen_f32` — PWM-style pulse. High when `now % period < period * dutyCycle`.
 */
export class pulse_gen_f32 extends Block implements IntervalHandler, CloseHandler {
  period: u32;
  dutyCycle: f32;
  streams: Array<Pss<f32>> = new Array<Pss<f32>>();
  timerId: u32 = 0;

  constructor(
    blockId: u32,
    widths: Uint8Array,
    ec: ExecutionContext,
    period: u32 = 10,
    dutyCycle: f32 = 0.5
  ) {
    super(blockId, widths, ec);
    this.period = period;
    this.dutyCycle = dutyCycle;
  }

  apply(streams: Array<Pss<f32>>): void {
    this.streams = streams;
    this.timerId = this.ec.setInterval(1, this);
    this.ec.onClose(this);
  }

  onInterval(): void {
    const period = this.period;
    let value: f32 = 0.0;
    if (period > 0) {
      const elapsed = this.ec.now() % u64(period);
      const highFor = u64(f32(period) * this.dutyCycle);
      if (elapsed < highFor) value = 1.0;
    }
    pushAll(this.streams, value);
  }

  onClose(): void {
    this.ec.clearInterval(this.timerId);
  }
}
