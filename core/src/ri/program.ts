import type { ExecutionContext, pss, VectorizedInput } from "./context";
import { push, HarmonicWaveGenerator } from "./blocks";
import { RiExecutionContext } from "./runtime";

export interface RiEndpoint {
  blockId: string;
  portId: string;
  vectorIndex: number;
}

export interface RiConnection {
  from: RiEndpoint;
  to: RiEndpoint;
}

export interface RiBlockSpec {
  id: string;
  ref: string;
  conf?: Record<string, unknown>;
}

export interface RiBlockInstance {
  readonly id: string;
  readonly numericId: number;
  readonly ref: string;
  readonly conf: Record<string, unknown>;
  readonly instance: unknown;
  /** Input handlers: portId -> array of consumers indexed by channel */
  inputs: Map<string, Array<pss<number>>>;
}

/**
 * Adapter interface encapsulating how an RI block is instantiated and wired.
 */
export interface IRiBlockAdapter {
  create(ctx: ExecutionContext, id: number, conf: Record<string, unknown>): unknown;
  wire(
    instance: unknown,
    outputConsumers: Map<string, Array<Array<pss<number>>>>,
    inputChannelCounts: Map<string, number>,
  ): Map<string, Array<pss<number>>>;
}

export abstract class BaseRiBlockAdapter implements IRiBlockAdapter {
  abstract create(ctx: ExecutionContext, id: number, conf: Record<string, unknown>): unknown;
  abstract wire(
    instance: unknown,
    outputConsumers: Map<string, Array<Array<pss<number>>>>,
    inputChannelCounts: Map<string, number>,
  ): Map<string, Array<pss<number>>>;

  protected getConsumers(outputs: Map<string, Array<Array<pss<number>>>>, ...ports: string[]): pss<number>[] {
    return ports.flatMap((p) => outputs.get(p)?.[0] ?? []);
  }
}

export class UnaryTransformerBlockAdapter extends BaseRiBlockAdapter {
  constructor(
    private readonly factory: (ctx: ExecutionContext, id: number) => {
      apply(v: VectorizedInput<pss<number>>): [pss<number>];
    },
    private readonly outPort: string,
  ) {
    super();
  }

  create(ctx: ExecutionContext, id: number): unknown {
    return this.factory(ctx, id);
  }

  wire(instance: unknown, outputs: Map<string, Array<Array<pss<number>>>>): Map<string, Array<pss<number>>> {
    const [handler] = (instance as { apply(v: VectorizedInput<pss<number>>): [pss<number>] }).apply(
      this.getConsumers(outputs, this.outPort, "v"),
    );
    return new Map([["v", [handler]]]);
  }
}

export class PeriodicReducerBlockAdapter extends BaseRiBlockAdapter {
  constructor(
    private readonly factory: (ctx: ExecutionContext, id: number, prec: number) => {
      apply(v: VectorizedInput<pss<number>>): [(size: number) => Array<pss<number>>];
    },
    private readonly outPort: string,
  ) {
    super();
  }

  create(ctx: ExecutionContext, id: number, conf: Record<string, unknown>): unknown {
    return this.factory(ctx, id, typeof conf.precision === "number" ? conf.precision : 10);
  }

  wire(
    instance: unknown,
    outputs: Map<string, Array<Array<pss<number>>>>,
    counts: Map<string, number>,
  ): Map<string, Array<pss<number>>> {
    const [vectorFactory] = (
      instance as { apply(v: VectorizedInput<pss<number>>): [(size: number) => Array<pss<number>>] }
    ).apply(this.getConsumers(outputs, this.outPort, "v"));
    return new Map([["v", vectorFactory(Math.max(1, counts.get("v") ?? 1))]]);
  }
}

export class SourceBlockAdapter extends BaseRiBlockAdapter {
  constructor(
    private readonly factory: (ctx: ExecutionContext, id: number, conf: Record<string, unknown>) => {
      apply(v: VectorizedInput<pss<number>>): void;
    },
  ) {
    super();
  }

  create(ctx: ExecutionContext, id: number, conf: Record<string, unknown>): unknown {
    return this.factory(ctx, id, conf);
  }

  wire(instance: unknown, outputs: Map<string, Array<Array<pss<number>>>>): Map<string, Array<pss<number>>> {
    (instance as { apply(v: VectorizedInput<pss<number>>): void }).apply(this.getConsumers(outputs, "v"));
    return new Map();
  }
}

export class ScopeSinkBlockAdapter extends BaseRiBlockAdapter {
  create(ctx: ExecutionContext, id: number, conf: Record<string, unknown>): unknown {
    const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
    return new push.f32.sinks.scope_f32(ctx, id, num(conf.period, 60), num(conf.precision, 10));
  }

  wire(instance: unknown, _out: unknown, counts: Map<string, number>): Map<string, Array<pss<number>>> {
    const [sinkFactory] = (instance as push.f32.sinks.scope_f32).apply();
    return new Map([["sink", sinkFactory(Math.max(1, counts.get("sink") ?? 1))]]);
  }
}

export class GpioSourceBlockAdapter extends BaseRiBlockAdapter {
  create(ctx: ExecutionContext, id: number, conf: Record<string, unknown>): unknown {
    const port = typeof conf.port === "number" ? conf.port : 0;
    const pinsArr = Array.isArray(conf.pins) ? conf.pins.map(Number) : [0];
    return new push.f32.sources.gpio_in_f32(ctx, id, port, new Uint8Array(pinsArr));
  }

  wire(instance: unknown, outputs: Map<string, Array<Array<pss<number>>>>): Map<string, Array<pss<number>>> {
    const pinChannels = outputs.get("pin") ?? [];
    (instance as push.f32.sources.gpio_in_f32).apply(pinChannels.length > 0 ? pinChannels : [[]]);
    return new Map();
  }
}

/**
 * Registry holding block instantiation and wiring adapters for RI blocks.
 */
export class RiBlockAdapterRegistry {
  private static readonly defaultInstance = new RiBlockAdapterRegistry();
  static get default(): RiBlockAdapterRegistry {
    return this.defaultInstance;
  }

  private readonly adapters = new Map<string, IRiBlockAdapter>();

  constructor() {
    this.registerDefaults();
  }

  register(ref: string, adapter: IRiBlockAdapter): void {
    this.adapters.set(ref, adapter);
  }

  get(ref: string): IRiBlockAdapter | undefined {
    return this.adapters.get(ref);
  }

  require(ref: string): IRiBlockAdapter {
    const adapter = this.get(ref);
    if (!adapter) throw new Error(`No RI adapter registered for block "${ref}"`);
    return adapter;
  }

  has(ref: string): boolean {
    return this.adapters.has(ref);
  }

  private registerDefaults(): void {
    const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);
    const harmonic = (
      Ctor: new (
        ctx: ExecutionContext,
        id: number,
        prec: number,
        freq: number,
        amp: number,
        phase: number,
      ) => HarmonicWaveGenerator,
    ) =>
      new SourceBlockAdapter(
        (ctx, id, c) => new Ctor(ctx, id, num(c.precision, 10), num(c.frequency, 1), num(c.amplitude, 1), num(c.phase, 0)),
      );

    this.register("cos_f32", new UnaryTransformerBlockAdapter((ctx, id) => new push.f32.transformers.cos_f32(ctx, id), "cos"));
    this.register("sin_f32", new UnaryTransformerBlockAdapter((ctx, id) => new push.f32.transformers.sin_f32(ctx, id), "sin"));
    this.register("product_f32", new PeriodicReducerBlockAdapter((ctx, id, p) => new push.f32.transformers.product_f32(ctx, id, p), "p"));
    this.register("sum_f32", new PeriodicReducerBlockAdapter((ctx, id, p) => new push.f32.transformers.sum_f32(ctx, id, p), "s"));
    this.register("scope_f32", new ScopeSinkBlockAdapter());
    this.register("const_f32", new SourceBlockAdapter((ctx, id, conf) => new push.f32.sources.const_f32(ctx, id, num(conf.v, 1))));
    this.register("cos_gen_f32", harmonic(push.f32.sources.cos_gen_f32));
    this.register("sin_gen_f32", harmonic(push.f32.sources.sin_gen_f32));
    this.register(
      "rand_gen_f32",
      new SourceBlockAdapter((ctx, id, conf) => new push.f32.sources.rand_gen_f32(ctx, id, num(conf.precision, 10), num(conf.amplitude, 1))),
    );
    this.register(
      "pulse_gen_f32",
      new SourceBlockAdapter((ctx, id, conf) => {
        const period = typeof conf.period === "number" ? conf.period : undefined;
        return new push.f32.sources.pulse_gen_f32(
          ctx,
          id,
          num(conf.duty_cycle, 0.5),
          num(conf.amplitude, 1),
          num(conf.frequency, period ? 1000 / period : 1),
          num(conf.phase, 0),
        );
      }),
    );

    const gpioAdapter = new GpioSourceBlockAdapter();
    this.register("gpio_in", gpioAdapter);
    this.register("gpio_in_f32", gpioAdapter);
  }
}

/**
 * Object-oriented Program representation for connecting and executing blocks
 * using the Reference Implementation (RI).
 */
export class RiProgram {
  private readonly blocks = new Map<string, RiBlockSpec>();
  private readonly connections: RiConnection[] = [];
  private readonly blockInstances = new Map<string, RiBlockInstance>();
  private isWired = false;

  constructor(
    readonly ctx: RiExecutionContext = new RiExecutionContext(),
    private readonly registry: RiBlockAdapterRegistry = RiBlockAdapterRegistry.default,
  ) {}

  addBlock(id: string, ref: string, conf: Record<string, unknown> = {}): this {
    if (this.blocks.has(id)) throw new Error(`Block "${id}" already added`);
    this.blocks.set(id, { id, ref, conf });
    return this;
  }

  connect(from: RiEndpoint, to: RiEndpoint): this {
    this.connections.push({ from, to });
    return this;
  }

  getNumericId(blockId: string): number {
    const block = this.blockInstances.get(blockId);
    if (!block) throw new Error(`Block "${blockId}" not found in program`);
    return block.numericId;
  }

  getBlockInstance(blockId: string): RiBlockInstance | undefined {
    return this.blockInstances.get(blockId);
  }

  /**
   * Instantiates all blocks, resolves input/output dependencies,
   * wires output consumer callbacks into input handlers, and prepares the runtime.
   */
  wire(): this {
    if (this.isWired) return this;
    const blockList = this.blocks.values().toArray();
    const ids = new Map<string, number>(blockList.map((b, i) => [b.id, i]));

    // 1. Instantiate all blocks
    for (const spec of blockList) {
      const numericId = ids.get(spec.id)!;
      const adapter = this.registry.require(spec.ref);
      const instance = adapter.create(this.ctx, numericId, spec.conf ?? {});
      this.blockInstances.set(spec.id, {
        id: spec.id,
        numericId,
        ref: spec.ref,
        conf: spec.conf ?? {},
        instance,
        inputs: new Map(),
      });
    }

    // 2. Determine input channel counts for every block and port
    const inChannelCounts = new Map<string, Map<string, number>>();
    for (const conn of this.connections) {
      const bMap = inChannelCounts.get(conn.to.blockId) ?? new Map<string, number>();
      inChannelCounts.set(conn.to.blockId, bMap);
      const current = bMap.get(conn.to.portId) ?? 0;
      bMap.set(conn.to.portId, Math.max(current, conn.to.vectorIndex + 1));
    }

    // 3. Reverse topological traversal so downstream blocks (sinks) are wired before upstream blocks (sources)
    const visited = new Set<string>();
    const reverseOrder: string[] = [];
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const conn of this.connections) {
        if (conn.from.blockId === id) visit(conn.to.blockId);
      }
      reverseOrder.push(id);
    };
    for (const b of blockList) visit(b.id);

    // 4. Wire blocks in reverse order
    for (const blockId of reverseOrder) {
      const bi = this.blockInstances.get(blockId)!;
      const adapter = this.registry.require(bi.ref);

      // Collect outgoing consumer callbacks for this block: portId -> channelIndex -> array of callbacks
      const outMap = new Map<string, Array<Array<pss<number>>>>();
      for (const conn of this.connections) {
        if (conn.from.blockId !== blockId) continue;
        const target = this.blockInstances.get(conn.to.blockId);
        const handler = target?.inputs.get(conn.to.portId)?.[conn.to.vectorIndex];
        if (!handler) continue;

        const portChannels = outMap.get(conn.from.portId) ?? [];
        outMap.set(conn.from.portId, portChannels);
        while (portChannels.length <= conn.from.vectorIndex) portChannels.push([]);
        portChannels[conn.from.vectorIndex].push(handler);
      }

      const blockInCounts = inChannelCounts.get(blockId) ?? new Map<string, number>();
      bi.inputs = adapter.wire(bi.instance, outMap, blockInCounts);
    }

    this.isWired = true;
    return this;
  }

  start(): this {
    if (!this.isWired) this.wire();
    this.ctx.start();
    return this;
  }

  close(): void {
    this.ctx.close();
  }

  tick(advanceMs = 0): void {
    this.ctx.tick(advanceMs);
  }

  tickThenObserve(): void {
    this.ctx.tickThenObserve();
  }

  emitGpio(port: number, pin: number, value: boolean): void {
    this.ctx.emitGpio(port, pin, value);
  }

  lastPin(blockId: string | number, pin: number): number {
    const numericId = typeof blockId === "string" ? this.getNumericId(blockId) : blockId;
    return this.ctx.lastPin(numericId, pin);
  }

  hasPin(blockId: string | number, pin: number): boolean {
    const numericId = typeof blockId === "string" ? this.getNumericId(blockId) : blockId;
    return this.ctx.hasPin(numericId, pin);
  }

  setNow(ms: number | bigint): void {
    this.ctx.setNow(ms);
  }

  setRandom(val: number): void {
    this.ctx.setRandom(val);
  }

  /**
   * Factory method building an RiProgram from DiagramJson.
   */
  static fromDiagramJson(json: {
    blocks?: Record<string, { ref: string; conf?: Record<string, unknown> }>;
    connections?: Record<
      string,
      {
        from: { block: string; port: { id: string; vector_index?: number } };
        to: { block: string; port: { id: string; vector_index?: number } };
      }
    >;
  }, ctx = new RiExecutionContext()): RiProgram {
    const program = new RiProgram(ctx);
    for (const [id, block] of Object.entries(json.blocks ?? {})) {
      program.addBlock(id, block.ref, block.conf);
    }
    for (const conn of Object.values(json.connections ?? {})) {
      program.connect(
        {
          blockId: conn.from.block,
          portId: conn.from.port.id,
          vectorIndex: conn.from.port.vector_index ?? 0,
        },
        {
          blockId: conn.to.block,
          portId: conn.to.port.id,
          vectorIndex: conn.to.port.vector_index ?? 0,
        },
      );
    }
    return program;
  }
}
