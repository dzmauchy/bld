import binaryen from "binaryen";
import type { DownstreamRef, PlannedBlock } from "./program";
import type { BlockSpec, BlockRegistry } from "./registry";
import { defaultRegistry } from "./registry";
import type { Expr } from "./module";
import { BrowserWasmModule } from "./module";

export type { Expr };

export function confNum(conf: Record<string, unknown>, key: string, fallback: number): number {
  const value = conf[key];
  return typeof value === "number" ? value : fallback;
}

export function confPins(conf: Record<string, unknown>): number[] {
  const raw = conf.pins;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((pin) => Number(pin));
  }
  return [0];
}

/**
 * Library assembly entry. Bundled JS should export `install(api)`.
 */
export class LibraryApi {
  constructor(private readonly registry: BlockRegistry) {}

  define(ref: string, spec: BlockSpec): void {
    this.registry.define(ref, spec);
  }
}

export function installLibrary(install: (api: LibraryApi) => void, registry: BlockRegistry = defaultRegistry): BlockRegistry {
  install(new LibraryApi(registry));
  return registry;
}

abstract class FnEmitter {
  protected stmts: Expr[] = [];
  protected extraLocals: binaryen.Type[] = [];
  protected abstract readonly paramCount: number;

  constructor(
    readonly wasm: BrowserWasmModule,
    readonly block: PlannedBlock,
  ) {}

  protected get m(): binaryen.Module {
    return this.wasm.m;
  }

  alloc(type: binaryen.Type): number {
    const index = this.paramCount + this.extraLocals.length;
    this.extraLocals.push(type);
    return index;
  }

  i32(value: number): Expr {
    return this.wasm.i32(value);
  }

  f32(value: number): Expr {
    return this.wasm.f32(value);
  }

  nan(): Expr {
    return this.f32(Number.NaN);
  }

  loc(index: number, type: binaryen.Type): Expr {
    return this.wasm.loc(index, type);
  }

  set(index: number, value: Expr): void {
    this.stmts.push(this.m.local.set(index, value));
  }

  do(expr: Expr): void {
    this.stmts.push(expr);
  }

  ret(): void {
    this.stmts.push(this.m.return());
  }

  ifClosedReturn(): void {
    this.do(this.wasm.ifClosedReturn());
  }

  recordPin(pin: Expr, value: Expr): void {
    this.do(this.wasm.recordPin(this.i32(this.block.id), pin, value));
  }

  cos(value: Expr): Expr {
    return this.m.call("host_cos", [value], binaryen.f32);
  }

  sin(value: Expr): Expr {
    return this.m.call("host_sin", [value], binaryen.f32);
  }

  mul(a: Expr, b: Expr): Expr {
    return this.m.f32.mul(a, b);
  }

  addF32(a: Expr, b: Expr): Expr {
    return this.m.f32.add(a, b);
  }

  addI32(a: Expr, b: Expr): Expr {
    return this.m.i32.add(a, b);
  }

  geU(a: Expr, b: Expr): Expr {
    return this.m.i32.ge_u(a, b);
  }

  eqI32(a: Expr, b: Expr): Expr {
    return this.m.i32.eq(a, b);
  }

  select(cond: Expr, ifTrue: Expr, ifFalse: Expr): Expr {
    return this.m.select(cond, ifTrue, ifFalse);
  }

  nowSeconds(): Expr {
    return this.m.f32.mul(
      this.m.f32.convert_u.i64(this.m.global.get("now", binaryen.i64)),
      this.f32(0.001),
    );
  }

  nowI64(): Expr {
    return this.m.global.get("now", binaryen.i64);
  }

  random(): Expr {
    return this.m.global.get("random", binaryen.f32);
  }

  i64LtU(a: Expr, b: Expr): Expr {
    return this.m.i64.lt_u(a, b);
  }

  i64RemU(a: Expr, b: Expr): Expr {
    return this.m.i64.rem_u(a, b);
  }

  i64ExtendU32(value: Expr): Expr {
    return this.m.i64.extend_u(value);
  }

  i64TruncUSatF32(value: Expr): Expr {
    return this.m.i64.trunc_u_sat.f32(value);
  }

  arrayLen(): Expr {
    return this.m.array.len(this.wasm.values(this.block.id));
  }

  arrayGet(index: Expr): Expr {
    return this.wasm.arrayGet(this.block.id, index);
  }

  store(index: Expr, value: Expr): void {
    this.do(
      this.m.if(
        this.geU(index, this.arrayLen()),
        this.m.return(),
        this.wasm.arraySet(this.block.id, index, value),
      ),
    );
  }

  letF32(value: Expr): () => Expr {
    const local = this.alloc(binaryen.f32);
    this.set(local, value);
    return () => this.loc(local, binaryen.f32);
  }

  forward(value: Expr, consumers: DownstreamRef[] = this.block.consumers): void {
    const local = this.alloc(binaryen.f32);
    this.set(local, value);
    for (const stmt of this.wasm.emitPushCalls(consumers, local)) {
      this.do(stmt);
    }
  }

  if_(cond: Expr, thenFn: () => void, elseFn?: () => void): void {
    const thenStmts = this.capture(thenFn);
    const elseStmts = elseFn ? this.capture(elseFn) : undefined;
    if (elseStmts) {
      this.do(this.m.if(cond, this.m.block(null, thenStmts), this.m.block(null, elseStmts)));
      return;
    }
    this.do(this.m.if(cond, this.m.block(null, thenStmts)));
  }

  forRange(limit: Expr, body: (index: () => Expr) => void): void {
    const index = this.alloc(binaryen.i32);
    const done = this.wasm.nextLabel("done");
    const loop = this.wasm.nextLabel("loop");
    this.set(index, this.i32(0));
    const bodyStmts = this.capture(() => body(() => this.loc(index, binaryen.i32)));
    this.do(
      this.m.block(done, [
        this.m.loop(
          loop,
          this.m.block(null, [
            this.m.if(this.geU(this.loc(index, binaryen.i32), limit), this.m.br(done)),
            ...bodyStmts,
            this.m.local.set(index, this.addI32(this.loc(index, binaryen.i32), this.i32(1))),
            this.m.br(loop),
          ]),
        ),
      ]),
    );
  }

  product(): Expr {
    const acc = this.alloc(binaryen.f32);
    this.set(acc, this.f32(1));
    this.forRange(this.arrayLen(), (index) => {
      this.set(acc, this.mul(this.loc(acc, binaryen.f32), this.arrayGet(index())));
    });
    return this.loc(acc, binaryen.f32);
  }

  protected capture(fn: () => void): Expr[] {
    const previous = this.stmts;
    this.stmts = [];
    fn();
    const captured = this.stmts;
    this.stmts = previous;
    return captured;
  }

  protected finishBody(): { locals: binaryen.Type[]; body: Expr[] } {
    return { locals: this.extraLocals, body: this.stmts };
  }
}

export class PushEmitter extends FnEmitter {
  protected readonly paramCount = 2;

  constructor(wasm: BrowserWasmModule, block: PlannedBlock) {
    super(wasm, block);
    this.ifClosedReturn();
  }

  get channel(): Expr {
    return this.loc(0, binaryen.i32);
  }

  get value(): Expr {
    return this.loc(1, binaryen.f32);
  }

  build(): { locals: binaryen.Type[]; body: Expr[] } {
    return this.finishBody();
  }
}

export class TickEmitter extends FnEmitter {
  protected readonly paramCount = 0;

  constructor(wasm: BrowserWasmModule, block: PlannedBlock) {
    super(wasm, block);
    this.ifClosedReturn();
  }

  build(): { locals: binaryen.Type[]; body: Expr[] } {
    return this.finishBody();
  }
}

export class GpioEmitter extends FnEmitter {
  protected readonly paramCount = 2;

  constructor(wasm: BrowserWasmModule, block: PlannedBlock) {
    super(wasm, block);
    this.ifClosedReturn();
  }

  get pinIndex(): Expr {
    return this.loc(0, binaryen.i32);
  }

  get rawValue(): Expr {
    return this.loc(1, binaryen.i32);
  }

  highIfTrue(): Expr {
    return this.select(this.rawValue, this.f32(1), this.f32(0));
  }

  eachPin(body: (pinIndex: number, consumers: DownstreamRef[]) => void): void {
    const groups = this.block.pinConsumers ?? [this.block.consumers];
    const pins = confPins(this.block.conf);
    const count = Math.max(pins.length, groups.length);
    for (let pinIndex = 0; pinIndex < count; pinIndex++) {
      const consumers = groups[pinIndex] ?? [];
      this.if_(this.eqI32(this.pinIndex, this.i32(pinIndex)), () => {
        body(pinIndex, consumers);
        this.ret();
      });
    }
  }

  build(): { locals: binaryen.Type[]; body: Expr[] } {
    return this.finishBody();
  }
}

/** Compile-time builder handed to a block `emit` implementation. */
export class BlockEmitter {
  constructor(
    readonly wasm: BrowserWasmModule,
    readonly block: PlannedBlock,
  ) {}

  get id(): number {
    return this.block.id;
  }

  get conf(): Record<string, unknown> {
    return this.block.conf;
  }

  get consumers(): DownstreamRef[] {
    return this.block.consumers;
  }

  get receiveChannels(): number {
    return this.block.receiveChannels;
  }

  confNum(key: string, fallback: number): number {
    return confNum(this.block.conf, key, fallback);
  }

  /** Allocate a GC f32 array used as the block's sliding/latest-value buffer. */
  values(init: "nan" | "one" | number): void {
    const value = init === "nan" ? Number.NaN : init === "one" ? 1 : init;
    this.wasm.initValues(this.block.id, this.block.receiveChannels, value);
  }

  onPush(handler: (push: PushEmitter) => void): void {
    const push = new PushEmitter(this.wasm, this.block);
    handler(push);
    const { locals, body } = push.build();
    this.wasm.addPushFunction(this.block.id, locals, body);
  }

  onTick(interval: number, handler: (tick: TickEmitter) => void): void {
    const tick = new TickEmitter(this.wasm, this.block);
    handler(tick);
    const { locals, body } = tick.build();
    this.wasm.addTickFunction(this.block.id, locals, body, interval);
  }

  onGpio(handler: (gpio: GpioEmitter) => void): void {
    const gpio = new GpioEmitter(this.wasm, this.block);
    handler(gpio);
    const { locals, body } = gpio.build();
    this.wasm.addGpioFunction(this.block.id, locals, body);
  }
}
