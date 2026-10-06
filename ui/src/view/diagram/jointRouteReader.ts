import { dia } from "@joint/core";
import { WirePoint } from "./geometry.js";

/** Reads the polyline the avoid router stored on a JointJS link. */
export class JointRouteReader {
  static read(graph: dia.Graph, link: dia.Link): WirePoint[] | undefined {
    const source = JointRouteReader.end(graph, link.source());
    const target = JointRouteReader.end(graph, link.target());
    if (!source || !target) return undefined;
    const vertices = link.vertices().map((point) => new WirePoint(point.x, point.y));
    return [source, ...vertices, target];
  }

  private static end(graph: dia.Graph, end: dia.Link.EndJSON): WirePoint | undefined {
    if (end.id === undefined) return undefined;
    const cell = graph.getCell(end.id);
    if (!cell?.isElement()) return undefined;
    const center = end.port ? cell.getPortCenter(end.port) : cell.getCenter();
    const delta = JointRouteReader.delta(end.anchor);
    return new WirePoint(center.x + delta.dx, center.y + delta.dy);
  }

  private static delta(anchor: dia.Link.EndJSON["anchor"]): { dx: number; dy: number } {
    const args = anchor?.args;
    if (!args || typeof args !== "object") return { dx: 0, dy: 0 };
    const record = args as { dx?: unknown; dy?: unknown };
    return {
      dx: typeof record.dx === "number" ? record.dx : 0,
      dy: typeof record.dy === "number" ? record.dy : 0,
    };
  }
}
