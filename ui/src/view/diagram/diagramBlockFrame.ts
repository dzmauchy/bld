import type { BlockDefinition } from "core";
import type { DiagramBlock } from "core";
import { WirePoint } from "./geometry.js";

interface PortSpec {
  id: string;
  vector: boolean;
}

/** One connector on a placed block, in the same coordinates JointJS uses for that side. */
export class FramePort {
  constructor(
    readonly id: string,
    readonly side: "input" | "output",
    readonly x: number,
    readonly y: number,
    readonly vector: boolean,
  ) {}
}

/**
 * Size and port anchors for a diagram block.
 * Port positions follow JointJS `left` / `right` line layout: each side is
 * distributed across the full element height at `(index + 0.5) / count`.
 */
export class DiagramBlockFrame {
  static readonly width = 156;
  static readonly minHeight = 72;
  static readonly portPitch = 28;

  private constructor(
    readonly width: number,
    readonly height: number,
    readonly ports: readonly FramePort[],
  ) {}

  static of(block: DiagramBlock): DiagramBlockFrame {
    return DiagramBlockFrame.create(
      block.getInputPorts().map((port) => ({ id: port.id, vector: port.vector })),
      block.getOutputPorts().map((port) => ({ id: port.id, vector: port.vector })),
    );
  }

  static forDefinition(definition: BlockDefinition): DiagramBlockFrame {
    return DiagramBlockFrame.create(
      [...definition.inputs.values()].map((port) => ({ id: port.id, vector: port.vector })),
      [...definition.outputs.values()].map((port) => ({ id: port.id, vector: port.vector })),
    );
  }

  static fromPorts(inputs: readonly string[], outputs: readonly string[]): DiagramBlockFrame {
    return DiagramBlockFrame.create(
      inputs.map((id) => ({ id, vector: false })),
      outputs.map((id) => ({ id, vector: false })),
    );
  }

  static portKey(side: "input" | "output", portId: string): string {
    return `${side}:${portId}`;
  }

  port(side: "input" | "output", portId: string): FramePort | undefined {
    return this.ports.find((port) => port.side === side && port.id === portId);
  }

  jointPorts(): {
    groups: {
      input: { position: { name: "left" } };
      output: { position: { name: "right" } };
    };
    items: { id: string; group: "input" | "output" }[];
  } {
    return {
      groups: {
        input: { position: { name: "left" } },
        output: { position: { name: "right" } },
      },
      items: this.ports.map((port) => ({
        id: DiagramBlockFrame.portKey(port.side, port.id),
        group: port.side,
      })),
    };
  }

  private static create(inputs: readonly PortSpec[], outputs: readonly PortSpec[]): DiagramBlockFrame {
    const count = Math.max(inputs.length, outputs.length, 1);
    const height = Math.max(DiagramBlockFrame.minHeight, count * DiagramBlockFrame.portPitch);
    const ports = [
      ...DiagramBlockFrame.along("input", inputs, height),
      ...DiagramBlockFrame.along("output", outputs, height),
    ];
    return new DiagramBlockFrame(DiagramBlockFrame.width, height, ports);
  }

  private static along(side: "input" | "output", specs: readonly PortSpec[], height: number): FramePort[] {
    const x = side === "input" ? 0 : DiagramBlockFrame.width;
    return specs.map((spec, index) => {
      const y = Math.round((height * (index + 0.5)) / specs.length);
      return new FramePort(spec.id, side, x, y, spec.vector);
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
  ) {}

  static from(block: DiagramBlock): PlacedBlock {
    return new PlacedBlock(
      block.id,
      block.ref,
      block.definition.title,
      block.definition.icon,
      block.definition.category,
      block.x,
      block.y,
      DiagramBlockFrame.of(block),
    );
  }

  anchor(side: "input" | "output", portId: string): WirePoint | undefined {
    const port = this.frame.port(side, portId);
    if (!port) return undefined;
    return new WirePoint(this.x + port.x, this.y + port.y);
  }
}
