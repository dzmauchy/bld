import { SlidingScopeBuffer, SlidingScopeBufferF64, type Diagram, type DiagramBlock, type SlidingBuffer } from "core";
import { ScopeBlock } from "./scopeBlock.js";

/** One scope output channel kept in a sliding sample ring. */
export class ScopeChannelTrace {
  private name: string;
  readonly buffer: SlidingBuffer<Float32Array | Float64Array>;

  constructor(readonly channel: number, label: string, precision: "f32" | "f64", capacity: number) {
    this.name = label;
    this.buffer = precision === "f64" ? new SlidingScopeBufferF64(capacity) : new SlidingScopeBuffer(capacity);
  }

  get label(): string {
    return this.name;
  }

  relabel(label: string): void {
    this.name = label;
  }

  push(value: number): void {
    this.buffer.push(value);
  }

  values(): number[] {
    return [...this.buffer.snapshot()];
  }

  clear(): void {
    this.buffer.clear();
  }
}

/** Samples for every output of one scope, sharing that scope's time window. */
export class ScopeMonitor {
  private readonly channels = new Map<number, ScopeChannelTrace>();

  constructor(
    readonly blockId: string,
    readonly title: string,
    readonly domainSeconds: number,
    readonly sampleSeconds: number,
    readonly precision: "f32" | "f64",
    readonly capacity: number,
  ) {}

  series(): ScopeChannelTrace[] {
    return [...this.channels.values()].sort((left, right) => left.channel - right.channel);
  }

  push(channel: number, value: number): void {
    const trace = this.channels.get(channel) ?? this.add(channel, `Channel ${channel}`);
    trace.push(value);
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
  }

  clear(): void {
    for (const trace of this.channels.values()) trace.clear();
  }

  private add(channel: number, label: string): ScopeChannelTrace {
    const trace = new ScopeChannelTrace(channel, label, this.precision, this.capacity);
    this.channels.set(channel, trace);
    return trace;
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
    monitor.push(channel, value);
    return true;
  }

  private ensure(diagram: Diagram, block: DiagramBlock, reset: boolean): ScopeMonitor {
    const domainSeconds = ScopeBlock.domainSeconds(block);
    const sampleMilliseconds = ScopeBlock.sampleMilliseconds(block);
    const sampleSeconds = sampleMilliseconds / 1000;
    const precision = ScopeBlock.precisionKind(block);
    const capacity = SlidingScopeBuffer.fromPeriod(domainSeconds, sampleMilliseconds).capacity;
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
