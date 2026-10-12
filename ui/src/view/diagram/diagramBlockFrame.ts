import type { BlockDefinition, Connection, DiagramBlock } from "core";
import { DiagramGrid, WirePoint } from "./geometry.js";

interface PortSpec {
  id: string;
  vector: boolean;
}

/** Fits the stacked icon, complete label, and optional configuration control. */
class BlockContentWidth {
  private static readonly labelWidths = new Map<string, number>();

  static forDefinition(definition: BlockDefinition): number {
    const minimum = definition.config.size > 0 ? 72 : 48;
    return DiagramGrid.ceil(Math.max(minimum, BlockContentWidth.labelWidth(definition.title) + 22));
  }

  private static labelWidth(title: string): number {
    if (typeof document === "undefined") return title.length * 7;
    const cached = this.labelWidths.get(title);
    if (cached !== undefined) return cached;
    const label = document.createElement("span");
    label.className = "diagram-block-title";
    label.textContent = title;
    Object.assign(label.style, { position: "absolute", visibility: "hidden", width: "max-content", pointerEvents: "none" });
    document.body.appendChild(label);
    try {
      const width = label.getBoundingClientRect().width;
      this.labelWidths.set(title, width);
      return width;
    } finally {
      label.remove();
    }
  }
}

/** Channels already wired to one port, in ascending vector-index order. */
class ChannelFan {
  readonly indexes: readonly number[];

  constructor(
    readonly vector: boolean,
    indexes: readonly number[],
  ) {
    this.indexes = [...new Set(indexes)].sort((left, right) => left - right);
  }

  /** A vector port keeps one lane before anything is connected, then one per channel. */
  get lanes(): number {
    return this.vector ? Math.max(1, this.indexes.length) : 1;
  }

  /** Vertical size of the port mark. Scalar ports keep the fixed hit target. */
  get span(): number {
    return this.vector ? this.lanes * DiagramBlockFrame.lanePitch : 0;
  }
}

/** Incoming and outgoing channel indexes for every port on one block. */
class ChannelLayout {
  private constructor(
    private readonly incoming: ReadonlyMap<string, readonly number[]>,
    private readonly outgoing: ReadonlyMap<string, readonly number[]>,
  ) {}

  static empty(): ChannelLayout {
    return new ChannelLayout(new Map(), new Map());
  }

  static forBlock(blockId: string, connections: readonly Connection[]): ChannelLayout {
    const incoming = new Map<string, number[]>();
    const outgoing = new Map<string, number[]>();
    for (const connection of connections) {
      if (connection.to.blockId === blockId) ChannelLayout.collect(incoming, connection.to.portId, connection.to.vectorIndex);
      if (connection.from.blockId === blockId) ChannelLayout.collect(outgoing, connection.from.portId, connection.from.vectorIndex);
    }
    return new ChannelLayout(incoming, outgoing);
  }

  fan(side: "input" | "output", spec: PortSpec): ChannelFan {
    const table = side === "input" ? this.incoming : this.outgoing;
    return new ChannelFan(spec.vector, table.get(spec.id) ?? []);
  }

  private static collect(table: Map<string, number[]>, portId: string, index: number): void {
    const indexes = table.get(portId) ?? [];
    indexes.push(index);
    table.set(portId, indexes);
  }
}

/** One connector on a placed block. Vector ports stack one lane per connection. */
export class FramePort {
  constructor(
    readonly id: string,
    readonly side: "input" | "output",
    readonly x: number,
    readonly y: number,
    readonly vector: boolean,
    readonly lanes: number,
    private readonly channelIndexes: readonly number[],
  ) {}

  /** Height of the port mark. Scalar ports use the stylesheet hit target. */
  get span(): number {
    return this.vector ? this.lanes * DiagramBlockFrame.lanePitch : 0;
  }

  /**
   * Canvas Y of one channel.
   * Omitting the index returns the port center, which is where a new wire starts.
   */
  anchorY(vectorIndex?: number): number {
    if (!this.vector || vectorIndex === undefined || this.lanes <= 1) return this.y;
    const slot = this.slot(vectorIndex);
    return this.y + (slot - (this.lanes - 1) / 2) * DiagramBlockFrame.lanePitch;
  }

  /** Pin centers measured from the top of the port mark. */
  pins(): { index: number; top: number }[] {
    if (!this.vector) return [];
    const indexes = this.channelIndexes.length > 0 ? this.channelIndexes : [0];
    return indexes.map((index, slot) => ({
      index,
      top: this.span / 2 + (slot - (this.lanes - 1) / 2) * DiagramBlockFrame.lanePitch,
    }));
  }

  private slot(vectorIndex: number): number {
    const found = this.channelIndexes.indexOf(vectorIndex);
    return found >= 0 ? found : 0;
  }
}

/**
 * Size and port anchors for a diagram block.
 * Distinct ports share the block height. A multiplexed port grows its own
 * lanes as connections are added, and the block grows once those lanes no
 * longer fit.
 */
export class DiagramBlockFrame {
  static readonly minWidth = DiagramGrid.ceil(48);
  static readonly heightSpacing = 2 * DiagramGrid.spacing;
  static readonly minHeight = DiagramGrid.ceil(64, DiagramBlockFrame.heightSpacing);
  static readonly portPitch = DiagramGrid.ceil(24);
  static readonly lanePitch = 2 * DiagramGrid.spacing;
  static readonly lanePadding = DiagramGrid.spacing;

  private constructor(
    readonly width: number,
    readonly height: number,
    readonly ports: readonly FramePort[],
  ) {}

  static of(block: DiagramBlock, connections: readonly Connection[] = []): DiagramBlockFrame {
    return DiagramBlockFrame.create(
      block.getInputPorts().map((port) => ({ id: port.id, vector: port.vector })),
      block.getOutputPorts().map((port) => ({ id: port.id, vector: port.vector })),
      ChannelLayout.forBlock(block.id, connections),
      BlockContentWidth.forDefinition(block.definition),
    );
  }

  static forDefinition(definition: BlockDefinition): DiagramBlockFrame {
    return DiagramBlockFrame.create(
      [...definition.inputs.values()].map((port) => ({ id: port.id, vector: port.vector })),
      [...definition.outputs.values()].map((port) => ({ id: port.id, vector: port.vector })),
      ChannelLayout.empty(),
      BlockContentWidth.forDefinition(definition),
    );
  }

  static fromPorts(inputs: readonly string[], outputs: readonly string[]): DiagramBlockFrame {
    return DiagramBlockFrame.create(
      inputs.map((id) => ({ id, vector: false })),
      outputs.map((id) => ({ id, vector: false })),
      ChannelLayout.empty(),
    );
  }

  port(side: "input" | "output", portId: string): FramePort | undefined {
    return this.ports.find((port) => port.side === side && port.id === portId);
  }

  private static create(inputs: readonly PortSpec[], outputs: readonly PortSpec[], layout: ChannelLayout, width = DiagramBlockFrame.minWidth): DiagramBlockFrame {
    const inputFans = inputs.map((spec) => layout.fan("input", spec));
    const outputFans = outputs.map((spec) => layout.fan("output", spec));
    const tallest = Math.max(0, ...inputFans.map((fan) => fan.span), ...outputFans.map((fan) => fan.span));
    const count = Math.max(inputs.length, outputs.length, 1);
    const height = DiagramGrid.ceil(Math.max(
      DiagramBlockFrame.minHeight,
      count * DiagramBlockFrame.portPitch,
      tallest + DiagramBlockFrame.lanePadding,
    ), DiagramBlockFrame.heightSpacing);
    const ports = [
      ...DiagramBlockFrame.along("input", inputs, inputFans, height, width),
      ...DiagramBlockFrame.along("output", outputs, outputFans, height, width),
    ];
    return new DiagramBlockFrame(width, height, ports);
  }

  private static along(side: "input" | "output", specs: readonly PortSpec[], fans: readonly ChannelFan[], height: number, width: number): FramePort[] {
    const x = side === "input" ? 0 : width;
    return specs.map((spec, index) => {
      const fan = fans[index] ?? new ChannelFan(spec.vector, []);
      const y = DiagramGrid.snap((height * (index + 0.5)) / specs.length);
      return new FramePort(spec.id, side, x, y, spec.vector, fan.lanes, fan.indexes);
    });
  }
}

/** Immutable snapshot of a placed block for the canvas view. */
export class PlacedBlock {
  constructor(
    readonly id: string,
    readonly ref: string,
    readonly title: string,
    readonly icon: string,
    readonly category: string,
    readonly x: number,
    readonly y: number,
    readonly frame: DiagramBlockFrame,
    readonly configurable: boolean,
  ) {}

  static from(block: DiagramBlock, connections: readonly Connection[] = []): PlacedBlock {
    const position = DiagramGrid.point(block.x, block.y);
    return new PlacedBlock(
      block.id,
      block.ref,
      block.definition.title,
      block.definition.icon,
      block.definition.category,
      position.x,
      position.y,
      DiagramBlockFrame.of(block, connections),
      block.definition.config.size > 0,
    );
  }

  anchor(side: "input" | "output", portId: string, vectorIndex?: number): WirePoint | undefined {
    const port = this.frame.port(side, portId);
    if (!port) return undefined;
    return new WirePoint(this.x + port.x, this.y + port.anchorY(vectorIndex));
  }
}
