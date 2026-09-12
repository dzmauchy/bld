import binaryen from "binaryen";
import {
  MEMORY_INITIAL_PAGES,
  MEMORY_MAX_PAGES,
  MAX_PINS,
  MAX_INTERVALS,
  OFFSET_WRITE_COUNT,
  OFFSET_HAS_PIN,
  OFFSET_LAST_PIN,
  OFFSET_INTERVAL_PERIODS,
} from "./memory";
import { mcuProfile, WasmProfile, type WasmProfileName } from "./profile";
import type { CompileOptions, DownstreamRef, PlannedBlock, WasmProgram } from "./program";

export type { CompileOptions, DownstreamRef, PlannedBlock, WasmProgram } from "./program";
export { mcuProfile, McuWasmProfile, WasmProfile, type WasmProfileName } from "./profile";
export { PUSH_BLOCK_REFS, TICK_BLOCK_REFS } from "./program";

type Expr = binaryen.ExpressionRef;
type BinModule = binaryen.Module;

function browserFeatures(): number {
  const F = binaryen.Features;
  return (
    F.SIMD128 |
    F.BulkMemory |
    F.BulkMemoryOpt |
    F.ReferenceTypes |
    F.Multivalue |
    F.SignExt |
    F.NontrappingFPToInt |
    F.ExtendedConst |
    F.ExceptionHandling |
    F.TailCall |
    F.GC |
    F.Atomics |
    F.Strings |
    F.MutableGlobals
  );
}

function copyBinary(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function pop(mod: BinModule, type: binaryen.Type): Expr {
  const api = binaryen as unknown as { _BinaryenPop(module: number, type: number): number };
  return api._BinaryenPop((mod as unknown as { ptr: number }).ptr, type);
}

function num(conf: Record<string, unknown>, key: string, fallback: number): number {
  const value = conf[key];
  return typeof value === "number" ? value : fallback;
}

function pinsOf(block: PlannedBlock): number[] {
  const raw = block.conf.pins;
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((p) => Number(p));
  }
  return [0];
}

function pushName(id: number): string {
  return `b${id}_push`;
}

function tickName(id: number): string {
  return `b${id}_tick`;
}

function gpioName(id: number): string {
  return `b${id}_gpio`;
}

function valuesGlobal(id: number): string {
  return `b${id}_vals`;
}

function categoryOrder(ref: string): number {
  if (ref === "scope_f32") return 0;
  if (ref === "product_f32" || ref === "cos_f32" || ref === "sin_f32") return 1;
  return 2;
}

class BrowserWasmModule {
  readonly m: BinModule;
  readonly arrayHeap: number;
  readonly arrayNull: binaryen.Type;
  readonly tickFns: string[] = [];
  readonly gpioIds: number[] = [];
  intervalPeriods: number[] = [];
  gpioCount = 0;

  constructor() {
    this.m = new binaryen.Module();
    this.m.setFeatures(browserFeatures());

    const tb = new binaryen.TypeBuilder(1);
    tb.setArrayType(0, binaryen.f32, binaryen.notPacked, true);
    const [arrayHeap] = tb.buildAndDispose();
    this.arrayHeap = arrayHeap;
    this.arrayNull = binaryen.getTypeFromHeapType(arrayHeap, true);

    this.m.setMemory(MEMORY_INITIAL_PAGES, MEMORY_MAX_PAGES, "memory", [], true);
    this.m.addTag("err", binaryen.i32, binaryen.none);

    this.m.addFunctionImport(
      "host_sendPinF32",
      "env",
      "sendPinF32",
      binaryen.createType([binaryen.i32, binaryen.i32, binaryen.f32]),
      binaryen.none,
    );
    this.m.addFunctionImport("host_cos", "env", "cos", binaryen.f32, binaryen.f32);
    this.m.addFunctionImport("host_sin", "env", "sin", binaryen.f32, binaryen.f32);
    this.m.addFunctionImport(
      "js_fromCharCode",
      "wasm:js-string",
      "fromCharCode",
      binaryen.i32,
      binaryen.externref,
    );
    this.m.addFunctionImport(
      "js_concat",
      "wasm:js-string",
      "concat",
      binaryen.createType([binaryen.externref, binaryen.externref]),
      binaryen.externref,
    );
    this.m.addFunctionImport("js_length", "wasm:js-string", "length", binaryen.externref, binaryen.i32);

    this.m.addGlobal("now", binaryen.i64, true, this.m.i64.const(0n));
    this.m.addGlobal("random", binaryen.f32, true, this.m.f32.const(0.5));
    this.m.addGlobal("closed", binaryen.i32, true, this.i32(0));
    this.m.addGlobal("intervalCount", binaryen.i32, true, this.i32(0));
    this.m.addGlobal("gpioCount", binaryen.i32, true, this.i32(0));
    this.m.addGlobal("stringProbe", binaryen.i32, true, this.m.i32.add(this.i32(0), this.i32(0)));

    this.emitRecordPin();
    this.emitRuntimeExports();
  }

  i32(value: number): Expr {
    return this.m.i32.const(value);
  }

  f32(value: number): Expr {
    return this.m.f32.const(value);
  }

  loc(index: number, type: binaryen.Type): Expr {
    return this.m.local.get(index, type);
  }

  closed(): Expr {
    return this.m.global.get("closed", binaryen.i32);
  }

  ifClosedReturn(): Expr {
    return this.m.if(this.closed(), this.m.return());
  }

  values(id: number): Expr {
    return this.m.ref.as_non_null(this.m.global.get(valuesGlobal(id), this.arrayNull));
  }

  arrayGet(id: number, index: Expr): Expr {
    return this.m.array.get(this.values(id), index, binaryen.f32, false);
  }

  arraySet(id: number, index: Expr, value: Expr): Expr {
    return this.m.array.set(this.values(id), index, value);
  }

  pinSlot(blockLocal: number, pinLocal: number): Expr {
    const m = this.m;
    return m.i32.add(
      m.i32.mul(this.loc(blockLocal, binaryen.i32), this.i32(MAX_PINS)),
      m.i32.and(m.i32.extend8_s(this.loc(pinLocal, binaryen.i32)), this.i32(MAX_PINS - 1)),
    );
  }

  emitRecordPin(): void {
    const m = this.m;
    m.addFunction(
      "recordPin",
      binaryen.createType([binaryen.i32, binaryen.i32, binaryen.f32]),
      binaryen.none,
      [binaryen.i32],
      m.block(null, [
        m.local.set(3, this.pinSlot(0, 1)),
        m.drop(m.i32.atomic.rmw.add(0, this.i32(OFFSET_WRITE_COUNT), this.i32(1))),
        m.i32.store8(0, 0, m.i32.add(this.i32(OFFSET_HAS_PIN), this.loc(3, binaryen.i32)), this.i32(1)),
        m.f32.store(
          0,
          0,
          m.i32.add(this.i32(OFFSET_LAST_PIN), m.i32.mul(this.loc(3, binaryen.i32), this.i32(4))),
          this.loc(2, binaryen.f32),
        ),
        m.call("host_sendPinF32", [this.loc(0, binaryen.i32), this.loc(1, binaryen.i32), this.loc(2, binaryen.f32)], binaryen.none),
      ]),
    );
  }

  recordPin(blockId: Expr, pin: Expr, value: Expr): Expr {
    return this.m.call("recordPin", [blockId, pin, value], binaryen.none);
  }

  emitPushCalls(consumers: DownstreamRef[], valueLocal: number): Expr[] {
    if (consumers.length === 0) return [];
    const m = this.m;
    const stmts: Expr[] = [];
    const last = consumers.length - 1;
    for (let i = 0; i < last; i++) {
      const dest = consumers[i];
      stmts.push(
        m.call(
          pushName(dest.blockId),
          [this.i32(dest.channel), this.loc(valueLocal, binaryen.f32)],
          binaryen.none,
        ),
      );
    }
    const dest = consumers[last];
    stmts.push(
      m.return_call(
        pushName(dest.blockId),
        [this.i32(dest.channel), this.loc(valueLocal, binaryen.f32)],
        binaryen.none,
      ),
    );
    return stmts;
  }

  emitRuntimeExports(): void {
    const m = this.m;
    m.addFunction(
      "setNow",
      binaryen.i32,
      binaryen.none,
      [],
      m.global.set("now", m.i64.extend_u(this.loc(0, binaryen.i32))),
    );
    m.addFunction(
      "setRandom",
      binaryen.f32,
      binaryen.none,
      [],
      m.global.set("random", this.loc(0, binaryen.f32)),
    );
    m.addFunction(
      "close",
      binaryen.none,
      binaryen.none,
      [],
      m.block(null, [
        m.global.set("closed", this.i32(1)),
        m.global.set("intervalCount", this.i32(0)),
        m.global.set("gpioCount", this.i32(0)),
      ]),
    );
    m.addFunction(
      "clearPins",
      binaryen.none,
      binaryen.none,
      [],
      m.block(null, [
        m.i32.atomic.store(0, this.i32(OFFSET_WRITE_COUNT), this.i32(0)),
        m.memory.fill(this.i32(OFFSET_HAS_PIN), this.i32(0), this.i32(MAX_PINS * 64)),
      ]),
    );
    m.addFunction(
      "pinWriteCount",
      binaryen.none,
      binaryen.i32,
      [],
      m.i32.atomic.load(0, this.i32(OFFSET_WRITE_COUNT)),
    );
    m.addFunction(
      "activeIntervalCount",
      binaryen.none,
      binaryen.i32,
      [],
      m.global.get("intervalCount", binaryen.i32),
    );
    m.addFunction(
      "activeGpioListenerCount",
      binaryen.none,
      binaryen.i32,
      [],
      m.global.get("gpioCount", binaryen.i32),
    );
    m.addFunction(
      "intervalPeriodAt",
      binaryen.i32,
      binaryen.i32,
      [],
      m.if(
        m.i32.ge_u(this.loc(0, binaryen.i32), m.global.get("intervalCount", binaryen.i32)),
        this.i32(0),
        m.i32.load(
          0,
          0,
          m.i32.add(
            this.i32(OFFSET_INTERVAL_PERIODS),
            m.i32.mul(this.loc(0, binaryen.i32), this.i32(4)),
          ),
        ),
      ),
    );
    m.addFunction(
      "hasPin",
      binaryen.createType([binaryen.i32, binaryen.i32]),
      binaryen.i32,
      [binaryen.i32],
      m.block(null, [
        m.local.set(2, this.pinSlot(0, 1)),
        m.i32.load8_u(0, 0, m.i32.add(this.i32(OFFSET_HAS_PIN), this.loc(2, binaryen.i32))),
      ], binaryen.i32),
    );
    m.addFunction(
      "lastPin",
      binaryen.createType([binaryen.i32, binaryen.i32]),
      binaryen.f32,
      [binaryen.i32],
      m.block(null, [
        m.local.set(2, this.pinSlot(0, 1)),
        m.if(
          m.i32.load8_u(0, 0, m.i32.add(this.i32(OFFSET_HAS_PIN), this.loc(2, binaryen.i32))),
          m.f32.load(
            0,
            0,
            m.i32.add(this.i32(OFFSET_LAST_PIN), m.i32.mul(this.loc(2, binaryen.i32), this.i32(4))),
          ),
          this.f32(Number.NaN),
        ),
      ], binaryen.f32),
    );
  }

  finishExports(program: WasmProgram): void {
    const m = this.m;
    if (this.tickFns.length > 0) {
      m.addTable("ticks", this.tickFns.length, this.tickFns.length);
      m.addActiveElementSegment("ticks", "tick_elem", this.tickFns, this.i32(0));
      m.addFunction(
        "tick",
        binaryen.none,
        binaryen.none,
        [binaryen.i32],
        m.block("tick_done", [
          this.ifClosedReturn(),
          m.local.set(0, this.i32(0)),
          m.loop(
            "tick_loop",
            m.block(null, [
              m.if(
                m.i32.ge_u(this.loc(0, binaryen.i32), this.i32(this.tickFns.length)),
                m.br("tick_done"),
              ),
              m.call_indirect("ticks", this.loc(0, binaryen.i32), [], binaryen.none, binaryen.none),
              m.local.set(0, m.i32.add(this.loc(0, binaryen.i32), this.i32(1))),
              m.br("tick_loop"),
            ]),
          ),
        ]),
      );
    } else {
      m.addFunction("tick", binaryen.none, binaryen.none, [], m.nop());
    }

    const gpioDispatch: Expr[] = [this.ifClosedReturn()];
    for (const id of this.gpioIds) {
      gpioDispatch.push(
        m.if(
          m.i32.eq(this.loc(0, binaryen.i32), this.i32(id)),
          m.block(null, [
            m.call(gpioName(id), [this.loc(1, binaryen.i32), this.loc(2, binaryen.i32)], binaryen.none),
            m.return(),
          ]),
        ),
      );
    }
    gpioDispatch.push(m.throw("err", [this.i32(1)]));
    m.addFunction(
      "emitGpioIn",
      binaryen.createType([binaryen.i32, binaryen.i32, binaryen.i32]),
      binaryen.none,
      [],
      m.try(
        "",
        m.block(null, gpioDispatch),
        ["err"],
        [m.drop(pop(m, binaryen.i32))],
        "",
      ),
    );

    m.addFunction(
      "tickThenObserve",
      binaryen.none,
      binaryen.none,
      [],
      m.block(null, [
        m.call("tick", [], binaryen.none),
        m.call("clearPins", [], binaryen.none),
        m.call("tick", [], binaryen.none),
      ]),
    );

    const startStmts: Expr[] = [
      m.global.set(
        "stringProbe",
        m.call(
          "js_length",
          [
            m.call(
              "js_concat",
              [
                m.call("js_fromCharCode", [this.i32(65)], binaryen.externref),
                m.call("js_fromCharCode", [this.i32(66)], binaryen.externref),
              ],
              binaryen.externref,
            ),
          ],
          binaryen.i32,
        ),
      ),
      m.global.set("intervalCount", this.i32(this.tickFns.length)),
      m.global.set("gpioCount", this.i32(this.gpioCount)),
    ];

    for (let i = 0; i < this.intervalPeriods.length && i < MAX_INTERVALS; i++) {
      startStmts.push(
        m.i32.store(0, 0, this.i32(OFFSET_INTERVAL_PERIODS + i * 4), this.i32(this.intervalPeriods[i] ?? 0)),
      );
    }

    for (const block of program.blocks) {
      if (block.ref === "scope_f32" || block.ref === "product_f32") {
        const init = block.ref === "scope_f32" ? this.f32(Number.NaN) : this.f32(1);
        startStmts.push(
          m.global.set(
            valuesGlobal(block.id),
            m.array.new(this.arrayHeap, this.i32(Math.max(1, block.receiveChannels)), init),
          ),
        );
      }
    }

    m.addFunction("start", binaryen.none, binaryen.none, [], m.block(null, startStmts));
    m.setStart(m.getFunction("start"));

    for (const name of [
      "tick",
      "close",
      "emitGpioIn",
      "setNow",
      "setRandom",
      "clearPins",
      "lastPin",
      "hasPin",
      "pinWriteCount",
      "activeIntervalCount",
      "intervalPeriodAt",
      "activeGpioListenerCount",
      "tickThenObserve",
    ]) {
      m.addFunctionExport(name, name);
    }
  }

  emitBlock(block: PlannedBlock): void {
    switch (block.ref) {
      case "scope_f32":
        this.emitScope(block);
        return;
      case "product_f32":
        this.emitProduct(block);
        return;
      case "cos_f32":
        this.emitUnary(block, "host_cos");
        return;
      case "sin_f32":
        this.emitUnary(block, "host_sin");
        return;
      case "const_f32":
        this.emitConst(block);
        return;
      case "cos_gen_f32":
        this.emitTrigGen(block, "host_cos");
        return;
      case "sin_gen_f32":
        this.emitTrigGen(block, "host_sin");
        return;
      case "rand_gen_f32":
        this.emitRandGen(block);
        return;
      case "pulse_gen_f32":
        this.emitPulseGen(block);
        return;
      case "gpio_in":
        this.emitGpioIn(block);
        return;
      default:
        throw new Error(`Unknown block type "${block.ref}"`);
    }
  }

  ensureValuesGlobal(id: number): void {
    this.m.addGlobal(valuesGlobal(id), this.arrayNull, true, this.m.ref.null(this.arrayNull));
  }

  emitScope(block: PlannedBlock): void {
    const m = this.m;
    this.ensureValuesGlobal(block.id);
    this.intervalPeriods.push(num(block.conf, "precision", 10));
    m.addFunction(
      pushName(block.id),
      binaryen.createType([binaryen.i32, binaryen.f32]),
      binaryen.none,
      [],
      m.block(null, [
        this.ifClosedReturn(),
        m.if(m.i32.ge_u(this.loc(0, binaryen.i32), m.array.len(this.values(block.id))), m.return()),
        this.arraySet(block.id, this.loc(0, binaryen.i32), this.loc(1, binaryen.f32)),
      ]),
    );
    m.addFunction(
      tickName(block.id),
      binaryen.none,
      binaryen.none,
      [binaryen.i32],
      m.block("scope_done", [
        this.ifClosedReturn(),
        m.local.set(0, this.i32(0)),
        m.loop(
          "scope_loop",
          m.block(null, [
            m.if(
              m.i32.ge_u(this.loc(0, binaryen.i32), m.array.len(this.values(block.id))),
              m.br("scope_done"),
            ),
            this.recordPin(this.i32(block.id), this.loc(0, binaryen.i32), this.arrayGet(block.id, this.loc(0, binaryen.i32))),
            m.local.set(0, m.i32.add(this.loc(0, binaryen.i32), this.i32(1))),
            m.br("scope_loop"),
          ]),
        ),
      ]),
    );
    this.tickFns.push(tickName(block.id));
  }

  emitProduct(block: PlannedBlock): void {
    const m = this.m;
    this.ensureValuesGlobal(block.id);
    m.addFunction(
      pushName(block.id),
      binaryen.createType([binaryen.i32, binaryen.f32]),
      binaryen.none,
      [binaryen.i32, binaryen.f32],
      m.block(null, [
        this.ifClosedReturn(),
        m.if(m.i32.ge_u(this.loc(0, binaryen.i32), m.array.len(this.values(block.id))), m.return()),
        this.arraySet(block.id, this.loc(0, binaryen.i32), this.loc(1, binaryen.f32)),
        this.recordPin(this.i32(block.id), this.loc(0, binaryen.i32), this.loc(1, binaryen.f32)),
        m.local.set(3, this.f32(1)),
        m.local.set(2, this.i32(0)),
        m.block("prod_end", [
          m.loop(
            "prod_loop",
            m.block(null, [
              m.if(
                m.i32.ge_u(this.loc(2, binaryen.i32), m.array.len(this.values(block.id))),
                m.br("prod_end"),
              ),
              m.local.set(3, m.f32.mul(this.loc(3, binaryen.f32), this.arrayGet(block.id, this.loc(2, binaryen.i32)))),
              m.local.set(2, m.i32.add(this.loc(2, binaryen.i32), this.i32(1))),
              m.br("prod_loop"),
            ]),
          ),
        ]),
        m.drop(m.tuple.extract(m.tuple.make([this.loc(1, binaryen.f32), this.loc(3, binaryen.f32)]), 1)),
        ...this.emitPushCalls(block.consumers, 3),
      ]),
    );
  }

  emitUnary(block: PlannedBlock, hostFn: string): void {
    const m = this.m;
    m.addFunction(
      pushName(block.id),
      binaryen.createType([binaryen.i32, binaryen.f32]),
      binaryen.none,
      [binaryen.f32],
      m.block(null, [
        this.ifClosedReturn(),
        m.local.set(2, m.call(hostFn, [this.loc(1, binaryen.f32)], binaryen.f32)),
        this.recordPin(this.i32(block.id), this.i32(0), this.loc(2, binaryen.f32)),
        ...this.emitPushCalls(block.consumers, 2),
      ]),
    );
  }

  emitConst(block: PlannedBlock): void {
    const m = this.m;
    this.intervalPeriods.push(num(block.conf, "precision", 10));
    m.addFunction(
      tickName(block.id),
      binaryen.none,
      binaryen.none,
      [binaryen.f32],
      m.block(null, [
        this.ifClosedReturn(),
        m.local.set(0, this.f32(num(block.conf, "v", 0))),
        ...this.emitPushCalls(block.consumers, 0),
      ]),
    );
    this.tickFns.push(tickName(block.id));
  }

  emitTrigGen(block: PlannedBlock, hostFn: string): void {
    const m = this.m;
    this.intervalPeriods.push(num(block.conf, "precision", 10));
    const t = m.f32.mul(m.f32.convert_u.i64(m.global.get("now", binaryen.i64)), this.f32(0.001));
    m.addFunction(
      tickName(block.id),
      binaryen.none,
      binaryen.none,
      [binaryen.f32],
      m.block(null, [
        this.ifClosedReturn(),
        m.local.set(0, m.call(hostFn, [t], binaryen.f32)),
        ...this.emitPushCalls(block.consumers, 0),
      ]),
    );
    this.tickFns.push(tickName(block.id));
  }

  emitRandGen(block: PlannedBlock): void {
    const m = this.m;
    this.intervalPeriods.push(num(block.conf, "precision", 10));
    m.addFunction(
      tickName(block.id),
      binaryen.none,
      binaryen.none,
      [binaryen.f32],
      m.block(null, [
        this.ifClosedReturn(),
        m.local.set(0, m.global.get("random", binaryen.f32)),
        ...this.emitPushCalls(block.consumers, 0),
      ]),
    );
    this.tickFns.push(tickName(block.id));
  }

  emitPulseGen(block: PlannedBlock): void {
    const m = this.m;
    const period = Math.max(0, num(block.conf, "period", 10));
    const duty = num(block.conf, "duty_cycle", 0.5);
    this.intervalPeriods.push(1);
    const high =
      period === 0
        ? this.f32(0)
        : m.select(
            m.i64.lt_u(
              m.i64.rem_u(m.global.get("now", binaryen.i64), m.i64.extend_u(this.i32(period))),
              m.i64.trunc_u_sat.f32(m.f32.mul(this.f32(period), this.f32(duty))),
            ),
            this.f32(1),
            this.f32(0),
          );
    m.addFunction(
      tickName(block.id),
      binaryen.none,
      binaryen.none,
      [binaryen.f32],
      m.block(null, [
        this.ifClosedReturn(),
        m.local.set(0, high),
        ...this.emitPushCalls(block.consumers, 0),
      ]),
    );
    this.tickFns.push(tickName(block.id));
  }

  emitGpioIn(block: PlannedBlock): void {
    const m = this.m;
    this.gpioIds.push(block.id);
    this.gpioCount += 1;
    const pins = pinsOf(block);
    const pinGroups = block.pinConsumers ?? [block.consumers];
    const stmts: Expr[] = [this.ifClosedReturn()];
    for (let pinIndex = 0; pinIndex < Math.max(pins.length, pinGroups.length); pinIndex++) {
      const consumers = pinGroups[pinIndex] ?? [];
      stmts.push(
        m.if(
          m.i32.eq(this.loc(0, binaryen.i32), this.i32(pinIndex)),
          m.block(null, [
            m.local.set(2, m.select(this.loc(1, binaryen.i32), this.f32(1), this.f32(0))),
            ...this.emitPushCalls(consumers, 2),
            m.return(),
          ]),
        ),
      );
    }
    m.addFunction(
      gpioName(block.id),
      binaryen.createType([binaryen.i32, binaryen.i32]),
      binaryen.none,
      [binaryen.f32],
      m.block(null, stmts),
    );
  }
}

function buildModule(program: WasmProgram, options: CompileOptions = {}): BinModule {
  const builder = new BrowserWasmModule();
  const blocks = [...program.blocks].sort((a, b) => categoryOrder(a.ref) - categoryOrder(b.ref) || a.id - b.id);
  for (const block of blocks) builder.emitBlock(block);
  builder.finishExports(program);
  if (options.optimizeLevel && options.optimizeLevel > 0) {
    binaryen.setOptimizeLevel(options.optimizeLevel);
    builder.m.optimize();
  }
  return builder.m;
}

export function compileBrowserProgram(program: WasmProgram, options: CompileOptions = {}): Uint8Array {
  const mod = buildModule(program, options);
  try {
    if (!mod.validate()) {
      throw new Error("Invalid browser wasm module");
    }
    return copyBinary(mod.emitBinary());
  } finally {
    mod.dispose();
  }
}

export function emitBrowserText(program: WasmProgram, options: CompileOptions = {}): string {
  const mod = buildModule(program, options);
  try {
    return mod.emitText();
  } finally {
    mod.dispose();
  }
}

export class BrowserWasmProfile extends WasmProfile {
  readonly name = "browser" as const;

  compile(program: WasmProgram, options?: CompileOptions): Uint8Array {
    return compileBrowserProgram(program, options);
  }

  override emitText(program: WasmProgram, options?: CompileOptions): string {
    return emitBrowserText(program, options);
  }
}

export const browserProfile = new BrowserWasmProfile();

export function getWasmProfile(name: WasmProfileName | WasmProfile): WasmProfile {
  if (typeof name !== "string") return name;
  if (name === "browser") return browserProfile;
  if (name === "mcu") return mcuProfile;
  throw new Error(`Unknown wasm profile "${name}"`);
}
