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
    const from = new OutputPortEndpoint(directed.from.blockId, directed.from.portId);
    const to = new InputPortEndpoint(directed.to.blockId, directed.to.portId);
    const input = this.diagram.getBlock(to.blockId)?.definition.getPort(to.portId, "input");
    if (!input) return undefined;
    if (!input.vector) {
      const occupied = this.diagram.getConnections().some((connection) => connection.to.portType === "input" && connection.to.blockId === to.blockId && connection.to.portId === to.portId);
      if (occupied) return undefined;
    }
    if (!this.diagram.canConnect(from, to).ok) return undefined;
    return this.diagram.connect(from, to);
  }
}
