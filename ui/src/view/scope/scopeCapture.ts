import { SlidingScopeBuffer, type Diagram, type DiagramBlock } from "core";
import { ScopeBlock } from "./scopeBlock.js";

/** Channel storage has no cursor; all channels read the scope's single pointer. */
export class ScopeChannelWindow {
  readonly data: Float32Array | Float64Array;

  constructor(private readonly scope: ScopeMonitor) {
    this.data = scope.precision === "f64" ? new Float64Array(scope.capacity) : new Float32Array(scope.capacity);
    this.data.fill(Number.NaN);
  }

  get capacity(): number { return this.scope.capacity; }
  get size(): number { return this.scope.size; }

  at(index: number): number {
    if (index < 0 || index >= this.capacity) return Number.NaN;
    return this.data[(this.scope.pointer + index) % this.capacity] ?? Number.NaN;
  }

  last(): number {
    return this.data[(this.scope.pointer + this.capacity - 1) % this.capacity] ?? Number.NaN;
  }
}

/** One scope output's label and fixed sample storage. */
export class ScopeChannelTrace {
  private name: string;
  readonly buffer: ScopeChannelWindow;

  constructor(readonly channel: number, label: string, scope: ScopeMonitor) {
    this.name = label;
    this.buffer = new ScopeChannelWindow(scope);
  }

  get label(): string {
    return this.name;
  }

  relabel(label: string): void {
    this.name = label;
  }

  clear(): void {
    this.buffer.data.fill(Number.NaN);
  }
}

/** Samples for every output of one scope, sharing that scope's time window. */
export class ScopeMonitor {
  private readonly channels = new Map<number, ScopeChannelTrace>();
  private input: Float32Array | Float64Array;
  private write = 0;
  private filled = 0;
  private elapsedMilliseconds = 0;

  constructor(
    readonly blockId: string,
    readonly title: string,
    readonly domainSeconds: number,
    readonly sampleSeconds: number,
    readonly precision: "f32" | "f64",
    readonly capacity: number,
  ) {
    this.input = this.createInput(0);
  }

  get pointer(): number { return this.write; }
  get size(): number { return this.filled; }
  get inputSize(): number { return this.input.length; }

  inputAt(channel: number): number { return this.input[channel] ?? Number.NaN; }

  series(): ScopeChannelTrace[] {
    return [...this.channels.values()].sort((left, right) => left.channel - right.channel);
  }

  /** Incoming data only changes its entry in the output-sized input vector. */
  accept(channel: number, value: number): boolean {
    if (!this.channels.has(channel)) return false;
    this.input[channel] = value;
    return true;
  }

  /** The diagram timer samples current channel values at the scope's precision. */
  sample(milliseconds: number): boolean {
    this.elapsedMilliseconds += milliseconds;
    const interval = this.sampleSeconds * 1000;
    if (this.elapsedMilliseconds < interval) return false;
    this.elapsedMilliseconds %= interval;
    if (this.channels.size === 0 || this.capacity === 0) return false;
    for (const trace of this.channels.values()) this.measure(trace);
    this.write = (this.write + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled++;
    return true;
  }

  syncChannels(channels: readonly { channel: number; label: string }[], replace = false): void {
    if (replace) {
      const live = new Set(channels.map((channel) => channel.channel));
      for (const channel of this.channels.keys()) {
        if (!live.has(channel)) this.channels.delete(channel);
      }
    }
    for (const channel of channels) {
      const existing = this.channels.get(channel.channel);
      if (existing) existing.relabel(channel.label);
      else this.add(channel.channel, channel.label);
    }
    let count = 0;
    for (const channel of this.channels.keys()) count = Math.max(count, channel + 1);
    if (count !== this.input.length) this.input = this.createInput(count);
  }

  clear(): void {
    this.write = 0;
    this.filled = 0;
    this.elapsedMilliseconds = 0;
    this.input.fill(Number.NaN);
    for (const trace of this.channels.values()) trace.clear();
  }

  private add(channel: number, label: string): ScopeChannelTrace {
    const trace = new ScopeChannelTrace(channel, label, this);
    this.channels.set(channel, trace);
    return trace;
  }

  private measure(trace: ScopeChannelTrace): void {
    trace.buffer.data[this.write] = this.input[trace.channel] ?? Number.NaN;
  }

  private createInput(count: number): Float32Array | Float64Array {
    const input = this.precision === "f64" ? new Float64Array(count) : new Float32Array(count);
    input.fill(Number.NaN);
    return input;
  }
}

/** Routes wasm pin writes to the scope that owns that block index. */
export class ScopeCaptureBoard {
  private readonly monitors = new Map<string, ScopeMonitor>();
  private readonly indexToBlock = new Map<number, string>();

  prepare(diagram: Diagram): void {
    const live = new Set<string>();
    this.indexToBlock.clear();
    diagram.getBlocks().forEach((block, index) => {
      this.indexToBlock.set(index, block.id);
      if (!ScopeBlock.isScope(block)) return;
      live.add(block.id);
      this.ensure(diagram, block, true);
    });
    for (const id of this.monitors.keys()) {
      if (!live.has(id)) this.monitors.delete(id);
    }
  }

  monitorFor(diagram: Diagram, blockId: string): ScopeMonitor | undefined {
    const block = diagram.getBlock(blockId);
    if (!block || !ScopeBlock.isScope(block)) return undefined;
    return this.ensure(diagram, block, false);
  }

  accept(blockIndex: number, channel: number, value: number): boolean {
    const blockId = this.indexToBlock.get(blockIndex);
    const monitor = blockId ? this.monitors.get(blockId) : undefined;
    if (!monitor) return false;
    return monitor.accept(channel, value);
  }

  sample(milliseconds: number): boolean {
    let sampled = false;
    for (const monitor of this.monitors.values()) sampled = monitor.sample(milliseconds) || sampled;
    return sampled;
  }

  /** Event-driven sources still need a timer to plot their current values. */
  samplingPeriod(): number | undefined {
    let period: number | undefined;
    for (const monitor of this.monitors.values()) {
      if (monitor.inputSize === 0) continue;
      const milliseconds = monitor.sampleSeconds * 1000;
      period = period === undefined ? milliseconds : Math.min(period, milliseconds);
    }
    return period;
  }

  private ensure(diagram: Diagram, block: DiagramBlock, reset: boolean): ScopeMonitor {
    const domainSeconds = ScopeBlock.domainSeconds(block);
    const sampleMilliseconds = ScopeBlock.sampleMilliseconds(block);
    const sampleSeconds = sampleMilliseconds / 1000;
    const precision = ScopeBlock.precisionKind(block);
    const capacity = SlidingScopeBuffer.capacityFor(domainSeconds, sampleMilliseconds);
    let monitor = this.monitors.get(block.id);
    if (
      !monitor ||
      monitor.domainSeconds !== domainSeconds ||
      monitor.sampleSeconds !== sampleSeconds ||
      monitor.precision !== precision ||
      monitor.capacity !== capacity
    ) {
      monitor = new ScopeMonitor(block.id, block.definition.title, domainSeconds, sampleSeconds, precision, capacity);
      this.monitors.set(block.id, monitor);
    } else if (reset) {
      monitor.clear();
    }
    monitor.syncChannels(ScopeBlock.channels(diagram, block), reset);
    return monitor;
  }
}
