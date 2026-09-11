import type { ExecutionContext, pss, VectorizedInput } from "./context";
import { push } from "./blocks";
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

/**
 * Registry holding block instantiation and wiring adapters for RI blocks.
 */
export class RiBlockAdapterRegistry {
  private static readonly _default = new RiBlockAdapterRegistry();
  static get default(): RiBlockAdapterRegistry {
    return this._default;
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
    // Transformer: cos_f32
    this.register("cos_f32", {
      create: (ctx, id) => new push.f32.transformers.cos_f32(ctx, id),
      wire: (inst, outMap) => {
        const consumers = (outMap.get("cos")?.[0] ?? []).concat(outMap.get("v")?.[0] ?? []);
        const [handler] = (inst as push.f32.transformers.cos_f32).apply(consumers);
        return new Map([["v", [handler]]]);
      },
    });

    // Transformer: sin_f32
    this.register("sin_f32", {
      create: (ctx, id) => new push.f32.transformers.sin_f32(ctx, id),
      wire: (inst, outMap) => {
        const consumers = (outMap.get("sin")?.[0] ?? []).concat(outMap.get("v")?.[0] ?? []);
        const [handler] = (inst as push.f32.transformers.sin_f32).apply(consumers);
        return new Map([["v", [handler]]]);
      },
    });

    // Transformer: product_f32
    this.register("product_f32", {
      create: (ctx, id, conf) =>
        new push.f32.transformers.product_f32(ctx, id, typeof conf.precision === "number" ? conf.precision : 10),
      wire: (inst, outMap, inCounts) => {
        const consumers = (outMap.get("p")?.[0] ?? []).concat(outMap.get("v")?.[0] ?? []);
        const [vectorFactory] = (inst as push.f32.transformers.product_f32).apply(consumers);
        const count = Math.max(1, inCounts.get("v") ?? 1);
        const handlers = vectorFactory(count);
        return new Map([["v", handlers]]);
      },
    });

    // Transformer: sum_f32
    this.register("sum_f32", {
      create: (ctx, id, conf) =>
        new push.f32.transformers.sum_f32(ctx, id, typeof conf.precision === "number" ? conf.precision : 10),
      wire: (inst, outMap, inCounts) => {
        const consumers = (outMap.get("s")?.[0] ?? []).concat(outMap.get("v")?.[0] ?? []);
        const [vectorFactory] = (inst as push.f32.transformers.sum_f32).apply(consumers);
        const count = Math.max(1, inCounts.get("v") ?? 1);
        const handlers = vectorFactory(count);
        return new Map([["v", handlers]]);
      },
    });

    // Sink: scope_f32
    this.register("scope_f32", {
      create: (ctx, id, conf) =>
        new push.f32.sinks.scope_f32(
          ctx,
          id,
          typeof conf.period === "number" ? conf.period : 60,
          typeof conf.precision === "number" ? conf.precision : 10,
        ),
      wire: (inst, _outMap, inCounts) => {
        const [sinkFactory] = (inst as push.f32.sinks.scope_f32).apply();
        const count = Math.max(1, inCounts.get("sink") ?? 1);
        const handlers = sinkFactory(count);
        return new Map([["sink", handlers]]);
      },
    });

    // Source: const_f32
    this.register("const_f32", {
      create: (ctx, id, conf) =>
        new push.f32.sources.const_f32(ctx, id, typeof conf.v === "number" ? conf.v : 1),
      wire: (inst, outMap) => {
        const consumers = outMap.get("v")?.[0] ?? [];
        (inst as push.f32.sources.const_f32).apply(consumers);
        return new Map();
      },
    });

    // Source: cos_gen_f32
    this.register("cos_gen_f32", {
      create: (ctx, id, conf) =>
        new push.f32.sources.cos_gen_f32(
          ctx,
          id,
          typeof conf.precision === "number" ? conf.precision : 10,
          typeof conf.frequency === "number" ? conf.frequency : 1,
          typeof conf.amplitude === "number" ? conf.amplitude : 1,
          typeof conf.phase === "number" ? conf.phase : 0,
        ),
      wire: (inst, outMap) => {
        const consumers = outMap.get("v")?.[0] ?? [];
        (inst as push.f32.sources.cos_gen_f32).apply(consumers);
        return new Map();
      },
    });

    // Source: sin_gen_f32
    this.register("sin_gen_f32", {
      create: (ctx, id, conf) =>
        new push.f32.sources.sin_gen_f32(
          ctx,
          id,
          typeof conf.precision === "number" ? conf.precision : 10,
          typeof conf.frequency === "number" ? conf.frequency : 1,
          typeof conf.amplitude === "number" ? conf.amplitude : 1,
          typeof conf.phase === "number" ? conf.phase : 0,
        ),
      wire: (inst, outMap) => {
        const consumers = outMap.get("v")?.[0] ?? [];
        (inst as push.f32.sources.sin_gen_f32).apply(consumers);
        return new Map();
      },
    });

    // Source: rand_gen_f32
    this.register("rand_gen_f32", {
      create: (ctx, id, conf) =>
        new push.f32.sources.rand_gen_f32(
          ctx,
          id,
          typeof conf.precision === "number" ? conf.precision : 10,
          typeof conf.amplitude === "number" ? conf.amplitude : 1,
        ),
      wire: (inst, outMap) => {
        const consumers = outMap.get("v")?.[0] ?? [];
        (inst as push.f32.sources.rand_gen_f32).apply(consumers);
        return new Map();
      },
    });

    // Source: pulse_gen_f32
    this.register("pulse_gen_f32", {
      create: (ctx, id, conf) => {
        const period = typeof conf.period === "number" ? conf.period : undefined;
        const frequency = typeof conf.frequency === "number" ? conf.frequency : (period ? 1000 / period : 1);
        return new push.f32.sources.pulse_gen_f32(
          ctx,
          id,
          typeof conf.duty_cycle === "number" ? conf.duty_cycle : 0.5,
          typeof conf.amplitude === "number" ? conf.amplitude : 1,
          frequency,
          typeof conf.phase === "number" ? conf.phase : 0,
        );
      },
      wire: (inst, outMap) => {
        const consumers = outMap.get("v")?.[0] ?? [];
        (inst as push.f32.sources.pulse_gen_f32).apply(consumers);
        return new Map();
      },
    });

    // Source: gpio_in / gpio_in_f32
    const gpioAdapter: IRiBlockAdapter = {
      create: (ctx, id, conf) => {
        const port = typeof conf.port === "number" ? conf.port : 0;
        const pinsArr = Array.isArray(conf.pins) ? conf.pins.map(Number) : [0];
        const pins = new Uint8Array(pinsArr);
        return new push.f32.sources.gpio_in_f32(ctx, id, port, pins);
      },
      wire: (inst, outMap) => {
        // outMap: port "pin" -> channel (pinIndex) -> consumers
        const pinChannels = outMap.get("pin") ?? [];
        const pinConsumers: VectorizedInput<pss<number>>[] = [];
        for (let i = 0; i < Math.max(1, pinChannels.length); i++) {
          pinConsumers.push(pinChannels[i] ?? []);
        }
        (inst as push.f32.sources.gpio_in_f32).apply(pinConsumers);
        return new Map();
      },
    };
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
    const blockList = [...this.blocks.values()];
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

    // 3. Topological sorting from sinks to sources (reverse topological)
    // Build outgoing graph
    const outgoing = new Map<string, Set<string>>();
    const incomingCount = new Map<string, number>();
    for (const b of blockList) {
      outgoing.set(b.id, new Set());
      incomingCount.set(b.id, 0);
    }
    for (const conn of this.connections) {
      if (outgoing.has(conn.from.blockId) && incomingCount.has(conn.to.blockId)) {
        if (!outgoing.get(conn.from.blockId)!.has(conn.to.blockId)) {
          outgoing.get(conn.from.blockId)!.add(conn.to.blockId);
          incomingCount.set(conn.to.blockId, incomingCount.get(conn.to.blockId)! + 1);
        }
      }
    }

    // Nodes with 0 outgoing connections are terminal sinks/leaves in data flow
    // Compute reverse topological order so downstream blocks are wired before upstream blocks
    const reverseOrder: string[] = [];
    const outgoingCount = new Map<string, number>(
      [...outgoing.entries()].map(([k, set]) => [k, set.size]),
    );
    const queue: string[] = [];
    for (const [id, count] of outgoingCount) {
      if (count === 0) queue.push(id);
    }
    while (queue.length > 0) {
      const curr = queue.shift()!;
      reverseOrder.push(curr);
      // For blocks that feed into curr, decrement their outgoing count
      for (const conn of this.connections) {
        if (conn.to.blockId === curr) {
          const fromId = conn.from.blockId;
          const count = outgoingCount.get(fromId);
          if (count !== undefined) {
            const next = count - 1;
            outgoingCount.set(fromId, next);
            if (next === 0) queue.push(fromId);
          }
        }
      }
    }

    // Any remaining blocks (e.g. cycles or isolated components)
    for (const b of blockList) {
      if (!reverseOrder.includes(b.id)) reverseOrder.push(b.id);
    }

    // 4. Wire blocks in reverse order
    for (const blockId of reverseOrder) {
      const bi = this.blockInstances.get(blockId)!;
      const adapter = this.registry.require(bi.ref);

      // Collect outgoing consumer callbacks for this block
      // outMap: portId -> channelIndex -> array of callbacks
      const outMap = new Map<string, Array<Array<pss<number>>>>();
      for (const conn of this.connections) {
        if (conn.from.blockId !== blockId) continue;
        const target = this.blockInstances.get(conn.to.blockId);
        if (!target) continue;
        const targetHandlers = target.inputs.get(conn.to.portId);
        const handler = targetHandlers?.[conn.to.vectorIndex];
        if (!handler) continue;

        let portChannels = outMap.get(conn.from.portId);
        if (!portChannels) {
          portChannels = [];
          outMap.set(conn.from.portId, portChannels);
        }
        while (portChannels.length <= conn.from.vectorIndex) {
          portChannels.push([]);
        }
        portChannels[conn.from.vectorIndex].push(handler);
      }

      const blockInCounts = inChannelCounts.get(blockId) ?? new Map<string, number>();
      const inputs = adapter.wire(bi.instance, outMap, blockInCounts);
      bi.inputs = inputs;
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
