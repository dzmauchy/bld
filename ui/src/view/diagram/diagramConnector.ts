import { Diagram, InputPortEndpoint, OutputPortEndpoint, type Connection } from "core";

/** A connector the pointer is holding or releasing. */
export class PortHit {
  constructor(
    readonly blockId: string,
    readonly portId: string,
    readonly side: "input" | "output",
  ) {}

  static fromTarget(target: EventTarget | null): PortHit | undefined {
    if (typeof Element === "undefined" || !(target instanceof Element)) return undefined;
    const port = target.closest("[data-port-id]");
    if (!(port instanceof HTMLElement)) return undefined;
    const block = port.closest("[data-diagram-block]");
    const blockId = block instanceof HTMLElement ? block.dataset.diagramBlock : undefined;
    const portId = port.dataset.portId;
    const side = port.dataset.portSide;
    if (!blockId || !portId) return undefined;
    if (side !== "input" && side !== "output") return undefined;
    return new PortHit(blockId, portId, side);
  }

  static fromPoint(clientX: number, clientY: number): PortHit | undefined {
    if (typeof document === "undefined") return undefined;
    return PortHit.fromTarget(document.elementFromPoint(clientX, clientY));
  }

  static blockIdFromTarget(target: EventTarget | null): string | undefined {
    if (typeof Element === "undefined" || !(target instanceof Element)) return undefined;
    if (target.closest("[data-port-id]")) return undefined;
    const block = target.closest("[data-diagram-block]");
    return block instanceof HTMLElement ? block.dataset.diagramBlock : undefined;
  }

  static isBackground(target: EventTarget | null): boolean {
    if (typeof Element === "undefined" || !(target instanceof Element)) return false;
    if (target.closest("[data-diagram-block]")) return false;
    return Boolean(target.closest("[data-diagram-canvas]"));
  }
}

/** Orders a drag so the diagram connection always runs from an output to an input. */
export class ConnectionRequest {
  constructor(
    readonly source: PortHit,
    readonly target: PortHit,
  ) {}

  directed(): { from: PortHit; to: PortHit } | undefined {
    if (this.source.blockId === this.target.blockId) return undefined;
    if (this.source.side === "output" && this.target.side === "input") {
      return { from: this.source, to: this.target };
    }
    if (this.source.side === "input" && this.target.side === "output") {
      return { from: this.target, to: this.source };
    }
    return undefined;
  }
}

/** Applies a connector drag to the diagram model. */
export class DiagramConnector {
  constructor(private readonly diagram: Diagram) {}

  tryConnect(source: PortHit, target: PortHit): Connection | undefined {
    const directed = new ConnectionRequest(source, target).directed();
    if (!directed) return undefined;
    const output = this.diagram.getBlock(directed.from.blockId)?.definition.getPort(directed.from.portId, "output");
    const input = this.diagram.getBlock(directed.to.blockId)?.definition.getPort(directed.to.portId, "input");
    if (!output || !input) return undefined;
    if (!input.vector && this.occupied(directed.to.blockId, directed.to.portId, "input")) return undefined;
    const from = new OutputPortEndpoint(
      directed.from.blockId,
      directed.from.portId,
      this.nextIndex(directed.from.blockId, directed.from.portId, "output", output.vector),
    );
    const to = new InputPortEndpoint(
      directed.to.blockId,
      directed.to.portId,
      this.nextIndex(directed.to.blockId, directed.to.portId, "input", input.vector),
    );
    if (!this.diagram.canConnect(from, to).ok) return undefined;
    return this.diagram.connect(from, to);
  }

  private occupied(blockId: string, portId: string, side: "input" | "output"): boolean {
    return this.diagram.getConnections().some((connection) => {
      const endpoint = side === "output" ? connection.from : connection.to;
      return endpoint.blockId === blockId && endpoint.portId === portId && endpoint.portType === side;
    });
  }

  /** The next free channel on a vector port. Scalar ports stay on channel 0. */
  private nextIndex(blockId: string, portId: string, side: "input" | "output", vector: boolean): number {
    if (!vector) return 0;
    const used = this.diagram.getConnections().flatMap((connection) => {
      const endpoint = side === "output" ? connection.from : connection.to;
      return endpoint.blockId === blockId && endpoint.portId === portId && endpoint.portType === side ? [endpoint.vectorIndex] : [];
    });
    if (used.length === 0) return 0;
    return Math.max(...used) + 1;
  }
}
