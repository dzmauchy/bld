import binaryen from "binaryen";
import type { DownstreamRef, WasmProgram } from "./program";

export type Expr = binaryen.ExpressionRef;
type BinModule = binaryen.Module;

/** Maximum pins per block for the GC pin arrays. */
const MAX_PINS = 8;

function browserFeatures(): number {
  const F = binaryen.Features;
  return (
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
    F.Strings |
    F.MutableGlobals
  );
}

function pop(mod: BinModule, type: binaryen.Type): Expr {
  const api = binaryen as unknown as { _BinaryenPop(module: number, type: number): number };
  return api._BinaryenPop((mod as unknown as { ptr: number }).ptr, type);
}

export function pushName(id: number): string {
  return `b${id}_push`;
}

export function tickName(id: number): string {
  return `b${id}_tick`;
}

export function gpioName(id: number): string {
  return `b${id}_gpio`;
}

function valuesGlobal(id: number): string {
  return `b${id}_vals`;
}

type ValueInit = { id: number; length: number; init: number };

export class BrowserWasmModule {
  readonly m: BinModule;
  readonly arrayHeap: number;
  readonly arrayNull: binaryen.Type;
  /** Heap type for (array (mut i32)) — used for pinHas, intervalPeriods. */
  readonly i32ArrayHeap: number;
  readonly i32ArrayNull: binaryen.Type;
  readonly tickFns: string[] = [];
  readonly gpioIds: number[] = [];
  intervalPeriods: number[] = [];
  gpioCount = 0;
  private labelSeq = 0;
  private readonly valueInits: ValueInit[] = [];
  private readonly startHooks: Expr[] = [];
  /** Tracks the total number of blocks to size the pin arrays. */
  private maxBlockId = 0;

  constructor() {
    this.m = new binaryen.Module();
    this.m.setFeatures(browserFeatures());

    const tb = new binaryen.TypeBuilder(2);
    // index 0: (array (mut f32)) — for per-block value arrays AND pinVals
    tb.setArrayType(0, binaryen.f32, binaryen.notPacked, true);
    // index 1: (array (mut i32)) — for pinHas and intervalPeriods
    tb.setArrayType(1, binaryen.i32, binaryen.notPacked, true);
    const [arrayHeap, i32ArrayHeap] = tb.buildAndDispose();
    this.arrayHeap = arrayHeap;
    this.arrayNull = binaryen.getTypeFromHeapType(arrayHeap, true);
    this.i32ArrayHeap = i32ArrayHeap;
    this.i32ArrayNull = binaryen.getTypeFromHeapType(i32ArrayHeap, true);

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
    this.m.addGlobal("pinWriteCount", binaryen.i32, true, this.i32(0));
    this.m.addGlobal("stringProbe", binaryen.i32, true, this.m.i32.add(this.i32(0), this.i32(0)));

    // GC arrays for pin state
    this.m.addGlobal("pinHas", this.i32ArrayNull, true, this.m.ref.null(this.i32ArrayNull));
    this.m.addGlobal("pinVals", this.arrayNull, true, this.m.ref.null(this.arrayNull));
    // GC array for interval periods
    this.m.addGlobal("intervalPeriods", this.i32ArrayNull, true, this.m.ref.null(this.i32ArrayNull));

    this.emitRecordPin();
    this.emitRuntimeExports();
  }

  nextLabel(prefix: string): string {
    this.labelSeq += 1;
    return `${prefix}_${this.labelSeq}`;
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

  /** Compute pin slot: blockId * MAX_PINS + (pin & (MAX_PINS - 1)). */
  private pinSlot(blockLocal: number, pinLocal: number): Expr {
    const m = this.m;
    return m.i32.add(
      m.i32.mul(this.loc(blockLocal, binaryen.i32), this.i32(MAX_PINS)),
      m.i32.and(m.i32.extend8_s(this.loc(pinLocal, binaryen.i32)), this.i32(MAX_PINS - 1)),
    );
  }

  private pinHasRef(): Expr {
    return this.m.ref.as_non_null(this.m.global.get("pinHas", this.i32ArrayNull));
  }

  private pinValsRef(): Expr {
    return this.m.ref.as_non_null(this.m.global.get("pinVals", this.arrayNull));
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
        // pinWriteCount++
        m.global.set("pinWriteCount", m.i32.add(m.global.get("pinWriteCount", binaryen.i32), this.i32(1))),
        // pinHas[slot] = 1
        m.array.set(this.pinHasRef(), this.loc(3, binaryen.i32), this.i32(1)),
        // pinVals[slot] = value
        m.array.set(this.pinValsRef(), this.loc(3, binaryen.i32), this.loc(2, binaryen.f32)),
        // call host
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
        m.global.set("pinWriteCount", this.i32(0)),
        m.array.fill(this.pinHasRef(), this.i32(0), this.i32(0), m.array.len(this.pinHasRef())),
      ]),
    );
    m.addFunction(
      "pinWriteCount_",
      binaryen.none,
      binaryen.i32,
      [],
      m.global.get("pinWriteCount", binaryen.i32),
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
        m.array.get(
          m.ref.as_non_null(m.global.get("intervalPeriods", this.i32ArrayNull)),
          this.loc(0, binaryen.i32),
          binaryen.i32,
          false,
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
        m.array.get(this.pinHasRef(), this.loc(2, binaryen.i32), binaryen.i32, false),
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
          m.array.get(this.pinHasRef(), this.loc(2, binaryen.i32), binaryen.i32, false),
          m.array.get(this.pinValsRef(), this.loc(2, binaryen.i32), binaryen.f32, false),
          this.f32(Number.NaN),
        ),
      ], binaryen.f32),
    );
  }

  trackBlockId(id: number): void {
    if (id > this.maxBlockId) this.maxBlockId = id;
  }

  finishExports(program: WasmProgram): void {
    const m = this.m;

    // Track max block id for pin array sizing
    for (const block of program.blocks) {
      this.trackBlockId(block.id);
    }

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

    // Pin array size: (maxBlockId + 1) * MAX_PINS
    const pinArraySize = (this.maxBlockId + 1) * MAX_PINS;

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
      // Initialize pin GC arrays
      m.global.set("pinHas", m.array.new(this.i32ArrayHeap, this.i32(pinArraySize), this.i32(0))),
      m.global.set("pinVals", m.array.new(this.arrayHeap, this.i32(pinArraySize), this.f32(Number.NaN))),
    ];

    // Initialize interval periods as a GC array
    if (this.intervalPeriods.length > 0) {
      const periodsArray = m.array.new(this.i32ArrayHeap, this.i32(this.intervalPeriods.length), this.i32(0));
      startStmts.push(m.global.set("intervalPeriods", periodsArray));
      for (let i = 0; i < this.intervalPeriods.length; i++) {
        startStmts.push(
          m.array.set(
            m.ref.as_non_null(m.global.get("intervalPeriods", this.i32ArrayNull)),
            this.i32(i),
            this.i32(this.intervalPeriods[i] ?? 0),
          ),
        );
      }
    } else {
      startStmts.push(m.global.set("intervalPeriods", m.array.new(this.i32ArrayHeap, this.i32(0), this.i32(0))));
    }

    const byId = new Map(program.blocks.map((block) => [block.id, block]));
    for (const init of this.valueInits) {
      const block = byId.get(init.id);
      const length = Math.max(1, block?.receiveChannels ?? init.length);
      startStmts.push(
        m.global.set(
          valuesGlobal(init.id),
          m.array.new(this.arrayHeap, this.i32(length), this.f32(init.init)),
        ),
      );
    }

    startStmts.push(...this.startHooks);
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
      "activeIntervalCount",
      "intervalPeriodAt",
      "activeGpioListenerCount",
      "tickThenObserve",
    ]) {
      m.addFunctionExport(name, name);
    }
    // pinWriteCount_ is the internal name to avoid collision with the global
    m.addFunctionExport("pinWriteCount_", "pinWriteCount");
  }

  ensureValuesGlobal(id: number): void {
    this.m.addGlobal(valuesGlobal(id), this.arrayNull, true, this.m.ref.null(this.arrayNull));
  }

  initValues(id: number, length: number, init: number): void {
    this.ensureValuesGlobal(id);
    this.trackBlockId(id);
    this.valueInits.push({ id, length, init });
  }

  addPushFunction(id: number, extraLocals: binaryen.Type[], body: Expr[]): void {
    this.trackBlockId(id);
    this.m.addFunction(
      pushName(id),
      binaryen.createType([binaryen.i32, binaryen.f32]),
      binaryen.none,
      extraLocals,
      this.m.block(null, body),
    );
  }

  addTickFunction(id: number, extraLocals: binaryen.Type[], body: Expr[], interval: number): void {
    this.trackBlockId(id);
    this.intervalPeriods.push(interval);
    this.m.addFunction(
      tickName(id),
      binaryen.none,
      binaryen.none,
      extraLocals,
      this.m.block(null, body),
    );
    this.tickFns.push(tickName(id));
  }

  addGpioFunction(id: number, extraLocals: binaryen.Type[], body: Expr[]): void {
    this.trackBlockId(id);
    this.gpioIds.push(id);
    this.gpioCount += 1;
    this.m.addFunction(
      gpioName(id),
      binaryen.createType([binaryen.i32, binaryen.i32]),
      binaryen.none,
      extraLocals,
      this.m.block(null, body),
    );
  }

  addStartHook(expr: Expr): void {
    this.startHooks.push(expr);
  }
}
