import type { Connection, DiagramBlock } from "core";
import { dia, shapes } from "@joint/core";
import type { SetRouteAttributesCallback } from "@joint/router-avoid";
import { DiagramBlockFrame } from "./diagramBlockFrame.js";
import { JointRouteReader } from "./jointRouteReader.js";
import { WireRoute, type WireOrigin } from "./wireRoute.js";

export type WireRouteListener = (route: WireRoute) => void;

/**
 * Keeps a JointJS graph of the diagram and asks `@joint/router-avoid`
 * to route its links around the blocks. `routeAll` is used instead of
 * `start` so a pass always sees the graph as it is when the pass begins.
 */
export abstract class WireRouter {
  abstract start(): void;
  abstract upsertBlock(block: DiagramBlock): void;
  abstract addLink(connection: Connection): void;
  abstract destroy(): void;
}

export class AvoidWireRouter extends WireRouter {
  private readonly graph = new dia.Graph({}, { cellNamespace: shapes });
  private service: { routeAll: () => Promise<unknown>; destroy: () => void } | undefined;
  private loading: Promise<void> | undefined;
  private pending = false;
  private running = false;
  private destroyed = false;

  constructor(private readonly listener: WireRouteListener) {
    super();
  }

  override start(): void {
    void this.ensure();
  }

  override upsertBlock(block: DiagramBlock): void {
    const frame = DiagramBlockFrame.of(block);
    const existing = this.graph.getCell(block.id);
    if (existing?.isElement()) {
      existing.position(block.x, block.y);
    } else {
      this.graph.addCell(
        new shapes.standard.Rectangle({
          id: block.id,
          position: { x: block.x, y: block.y },
          size: { width: frame.width, height: frame.height },
          ports: frame.jointPorts(),
        }),
      );
    }
    this.touch();
  }

  override addLink(connection: Connection): void {
    if (this.graph.getCell(connection.id)) {
      this.touch();
      return;
    }
    this.graph.addCell(
      new shapes.standard.Link({
        id: connection.id,
        source: {
          id: connection.from.blockId,
          port: DiagramBlockFrame.portKey("output", connection.from.portId),
        },
        target: {
          id: connection.to.blockId,
          port: DiagramBlockFrame.portKey("input", connection.to.portId),
        },
      }),
    );
    this.touch();
  }

  override destroy(): void {
    this.destroyed = true;
    this.pending = false;
    this.service?.destroy();
    this.service = undefined;
  }

  private touch(): void {
    this.pending = true;
    if (!this.service) {
      void this.ensure().then(() => {
        if (this.pending && !this.running && !this.destroyed) void this.run();
      });
      return;
    }
    if (!this.running) void this.run();
  }

  private ensure(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    const { initAvoidRouter } = await import("@joint/router-avoid");
    const service = await initAvoidRouter(this.graph, {
      shapeBufferDistance: 14,
      idealNudgingDistance: 8,
      libavoidFilePath: "/libavoid.wasm",
      setRouteAttributes: (params) => this.apply(params),
    });
    if (this.destroyed) {
      service.destroy();
      return;
    }
    this.service = service;
  }

  private async run(): Promise<void> {
    if (!this.service || this.destroyed) return;
    this.running = true;
    try {
      while (!this.destroyed && this.service) {
        this.pending = false;
        await this.service.routeAll();
        if (!this.pending || this.destroyed) break;
      }
    } catch (error) {
      this.pending = false;
      console.error(error);
    } finally {
      this.running = false;
    }
  }

  private apply(params: Parameters<SetRouteAttributesCallback>[0]): void {
    if (this.destroyed || params.routing) return;
    const { link, attributes, origin } = params;
    link.set(
      {
        source: attributes.source,
        target: attributes.target,
        vertices: attributes.vertices,
      },
      { avoidRouter: true },
    );
    const points = JointRouteReader.read(this.graph, link);
    if (!points) return;
    const wireOrigin: WireOrigin = origin === "avoid" ? "avoid" : "fallback";
    this.listener(new WireRoute(String(link.id), points, wireOrigin));
  }
}
