import type { Connection, DiagramBlock } from "core";
import { BaseGraph, CellRenderer, EdgeStyle, ManhattanConnectorConfig, type Cell, type CellState } from "@maxgraph/core";
import { PlacedBlock } from "./diagramBlockFrame.js";
import { WirePoint } from "./geometry.js";
import { WireRoute } from "./wireRoute.js";
import { WireRouter, type WireRouteListener } from "./wireRouter.js";

/** Computes cell states without creating a second, invisible diagram renderer. */
class RoutingCellRenderer extends CellRenderer {
  override redraw(_state: CellState): void {}
}

/** Uses maxGraph's Manhattan connector to route between ports around every block. */
export class MaxGraphWireRouter extends WireRouter {
  private graph: BaseGraph | undefined;
  private readonly blocks = new Map<string, PlacedBlock>();
  private readonly connections = new Map<string, Connection>();
  private readonly blockCells = new Map<string, Cell>();
  private readonly edgeCells = new Map<string, Cell>();
  private scheduled = false;
  private destroyed = false;

  constructor(private readonly listener: WireRouteListener) {
    super();
  }

  override start(): void {
    if (this.graph || this.destroyed) return;
    // These are global maxGraph settings; this application uses only this
    // connector, with outputs on the right and inputs on the left.
    ManhattanConnectorConfig.startDirections = ["east"];
    ManhattanConnectorConfig.endDirections = ["west"];
    ManhattanConnectorConfig.step = 14;
    this.graph = new BaseGraph({
      cellRenderer: new RoutingCellRenderer(),
    });
    this.graph.setEnabled(false);
    this.touch();
  }

  override upsertBlock(block: DiagramBlock): void {
    if (this.destroyed) return;
    this.blocks.set(block.id, PlacedBlock.from(block));
    this.touch();
  }

  override addLink(connection: Connection): void {
    if (this.destroyed) return;
    this.connections.set(connection.id, connection);
    this.touch();
  }

  override destroy(): void {
    this.destroyed = true;
    this.graph?.destroy();
    this.graph = undefined;
    this.blocks.clear();
    this.connections.clear();
    this.blockCells.clear();
    this.edgeCells.clear();
  }

  private touch(): void {
    if (!this.graph || this.scheduled || this.destroyed) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) this.route();
    });
  }

  private route(): void {
    const graph = this.graph;
    if (!graph) return;
    graph.batchUpdate(() => {
      for (const block of this.blocks.values()) this.updateBlock(graph, block);
      for (const connection of this.connections.values()) this.updateEdge(graph, connection);
    });
    const view = graph.getView();
    // Validate all obstacles before edges, including blocks inserted after a
    // connector. Moving an unrelated obstacle must also reroute existing edges.
    for (const cell of this.blockCells.values()) view.validateCellState(cell, false);
    for (const cell of this.edgeCells.values()) view.invalidate(cell);
    view.validate();
    for (const [id, cell] of this.edgeCells) {
      const points = view.getState(cell)?.absolutePoints;
      if (!points || points.some((point) => point === null)) continue;
      const route = points.flatMap((point) => point ? [new WirePoint(point.x, point.y)] : []);
      if (route.length >= 2) this.listener(new WireRoute(id, route, "maxgraph"));
    }
  }

  private updateBlock(graph: BaseGraph, block: PlacedBlock): void {
    const cell = this.blockCells.get(block.id);
    if (!cell) {
      this.blockCells.set(block.id, graph.insertVertex({
        id: block.id,
        position: [block.x, block.y],
        size: [block.frame.width, block.frame.height],
      }));
      return;
    }
    const geometry = cell.getGeometry();
    if (!geometry || (geometry.x === block.x && geometry.y === block.y
      && geometry.width === block.frame.width && geometry.height === block.frame.height)) return;
    const updated = geometry.clone();
    updated.x = block.x;
    updated.y = block.y;
    updated.width = block.frame.width;
    updated.height = block.frame.height;
    graph.getDataModel().setGeometry(cell, updated);
  }

  private updateEdge(graph: BaseGraph, connection: Connection): void {
    const source = this.blocks.get(connection.from.blockId);
    const target = this.blocks.get(connection.to.blockId);
    const output = source?.frame.port("output", connection.from.portId);
    const input = target?.frame.port("input", connection.to.portId);
    const sourceCell = source && this.blockCells.get(source.id);
    const targetCell = target && this.blockCells.get(target.id);
    if (!source || !target || !output || !input || !sourceCell || !targetCell) return;
    const style = {
      edgeStyle: EdgeStyle.ManhattanConnector,
      orthogonal: true,
      exitX: 1,
      exitY: output.y / source.frame.height,
      exitPerimeter: false,
      entryX: 0,
      entryY: input.y / target.frame.height,
      entryPerimeter: false,
    };
    const existing = this.edgeCells.get(connection.id);
    if (existing) {
      graph.getDataModel().setStyle(existing, style);
      return;
    }
    this.edgeCells.set(connection.id, graph.insertEdge({
      id: connection.id,
      source: sourceCell,
      target: targetCell,
      style,
    }));
  }
}
