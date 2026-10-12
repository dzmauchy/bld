import { Diagram, type BlockDefinition, type Connection } from "core";
import { createSignal, type Accessor } from "solid-js";
import { MaxGraphWireRouter } from "./maxGraphWireRouter.js";
import type { WireRouter } from "./wireRouter.js";
import { CanvasPoint, OrthogonalRoute, WirePoint } from "./geometry.js";
import { DiagramBlockFrame, PlacedBlock } from "./diagramBlockFrame.js";
import { DiagramConnector, PortHit } from "./diagramConnector.js";
import { BlockMoveGesture, PointerGesture, StampGesture, type DiagramGestureHost } from "./diagramGestures.js";
import { PaletteArm } from "./paletteArm.js";
import { ScopeBlock } from "../scope/scopeBlock.js";
import { WireRoute } from "./wireRoute.js";
import { DiagramSelection } from "./diagramSelection.js";

/** Canvas session: click-to-insert, block moves, and output-to-input selection. */
export class DiagramEditor implements DiagramGestureHost {
  private readonly connector: DiagramConnector;
  private readonly arm = new PaletteArm();
  private canvas: HTMLElement | undefined;
  private gesture: PointerGesture | undefined;

  readonly selection: Accessor<DiagramSelection>;
  private readonly setSelection: (selection: DiagramSelection) => void;

  readonly placed: Accessor<readonly PlacedBlock[]>;
  private readonly setPlaced: (blocks: readonly PlacedBlock[]) => void;
  readonly routes: Accessor<readonly WireRoute[]>;
  private readonly setRoutes: (routes: readonly WireRoute[]) => void;
  readonly armedId: Accessor<string | undefined>;
  private readonly setArmedId: (id: string | undefined) => void;
  readonly selectedOutput: Accessor<PortHit | undefined>;
  private readonly setSelectedOutput: (port: PortHit | undefined) => void;
  readonly movingId: Accessor<string | undefined>;
  private readonly setMovingId: (id: string | undefined) => void;
  readonly inspectedId: Accessor<string | undefined>;
  private readonly setInspectedId: (id: string | undefined) => void;
  readonly configuredId: Accessor<string | undefined>;
  private readonly setConfiguredId: (id: string | undefined) => void;
  readonly configRevision: Accessor<number>;
  private readonly setConfigRevision: (revision: number) => void;

  private readonly routeMap = new Map<string, WireRoute>();

  private readonly router: WireRouter;

  constructor(
    private readonly diagram: Diagram,
    router?: WireRouter,
    private readonly onDelete?: () => void,
  ) {
    this.connector = new DiagramConnector(diagram);
    const selection = createSignal(DiagramSelection.empty());
    this.selection = selection[0];
    this.setSelection = selection[1];
    const placed = createSignal<readonly PlacedBlock[]>([]);
    this.placed = placed[0];
    this.setPlaced = placed[1];
    const routes = createSignal<readonly WireRoute[]>([]);
    this.routes = routes[0];
    this.setRoutes = routes[1];
    const armed = createSignal<string | undefined>();
    this.armedId = armed[0];
    this.setArmedId = armed[1];
    const selectedOutput = createSignal<PortHit | undefined>();
    this.selectedOutput = selectedOutput[0];
    this.setSelectedOutput = selectedOutput[1];
    const moving = createSignal<string | undefined>();
    this.movingId = moving[0];
    this.setMovingId = moving[1];
    const inspected = createSignal<string | undefined>();
    this.inspectedId = inspected[0];
    this.setInspectedId = inspected[1];
    const configured = createSignal<string | undefined>();
    this.configuredId = configured[0];
    this.setConfiguredId = configured[1];
    const configRevision = createSignal(0);
    this.configRevision = configRevision[0];
    this.setConfigRevision = configRevision[1];
    this.router = router ?? new MaxGraphWireRouter((route) => this.acceptRoute(route));
  }

  get model(): Diagram {
    return this.diagram;
  }

  start(): void {
    this.router.start();
  }

  destroy(): void {
    this.clearGesture();
    this.setSelectedOutput(undefined);
    this.router.destroy();
  }

  attachCanvas(canvas: HTMLElement | undefined): void {
    this.canvas = canvas;
  }

  canvasElement(): HTMLElement | undefined {
    return this.canvas;
  }

  canvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.gesture) return;
    this.canvas?.focus({ preventScroll: true });
    const wire = event.target instanceof Element ? event.target.closest("[data-wire-id]") : undefined;
    const connectionId = wire?.getAttribute("data-wire-id");
    if (connectionId) {
      event.preventDefault();
      this.selectConnection(connectionId, event.shiftKey || event.ctrlKey || event.metaKey);
      return;
    }
    const port = PortHit.fromTarget(event.target);
    if (port) return;
    const blockId = PortHit.blockIdFromTarget(event.target);
    if (blockId) {
      event.preventDefault();
      this.begin(new BlockMoveGesture(this, blockId, event));
      return;
    }
    if (PortHit.isBackground(event.target)) {
      event.preventDefault();
      this.clearSelection();
      this.begin(new StampGesture(this, event));
    }
  }

  armDefinition(definition: BlockDefinition): void {
    this.clearSelection();
    this.setArmedId(this.arm.toggle(definition)?.id);
  }

  armedDefinition(): BlockDefinition | undefined {
    return this.arm.definition;
  }

  place(definition: BlockDefinition, clientX: number, clientY: number): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!CanvasPoint.inside(rect, clientX, clientY)) return;
    const frame = DiagramBlockFrame.forDefinition(definition);
    const at = CanvasPoint.centered(CanvasPoint.relative(rect, clientX, clientY), frame.width, frame.height);
    const block = this.diagram.addBlock(definition, { x: at.x, y: at.y });
    this.router.upsertBlock(block);
    this.publishPlaced();
  }

  selectPort(port: PortHit): void {
    const block = this.diagram.getBlock(port.blockId);
    if (!block?.definition.getPort(port.portId, port.side)) return;
    this.disarmPalette();
    if (port.side === "output") {
      const selected = this.isPortSelected(port.blockId, port.portId, port.side);
      this.clearSelection();
      this.setSelectedOutput(selected ? undefined : port);
      return;
    }
    const output = this.selectedOutput();
    if (output && this.connect(output, port)) this.setSelectedOutput(undefined);
  }

  isPortSelected(blockId: string, portId: string, side: "input" | "output"): boolean {
    const output = this.selectedOutput();
    return output?.blockId === blockId && output.portId === portId && output.side === side;
  }

  moveBlock(blockId: string, x: number, y: number): void {
    const block = this.diagram.getBlock(blockId);
    if (!block) return;
    block.setPosition(Math.max(0, Math.round(x)), Math.max(0, Math.round(y)));
    this.router.upsertBlock(block);
    this.refreshProvisional(blockId);
    this.publishPlaced();
  }

  blockOrigin(blockId: string): WirePoint | undefined {
    const block = this.diagram.getBlock(blockId);
    return block ? new WirePoint(block.x, block.y) : undefined;
  }

  setMoving(blockId: string | undefined): void {
    this.setMovingId(blockId);
  }

  selectBlock(blockId: string, additive = false): void {
    const block = this.diagram.getBlock(blockId);
    if (!block) return;
    this.disarmPalette();
    this.setSelectedOutput(undefined);
    this.setSelection(this.selection().selectBlock(blockId, additive));
    if (ScopeBlock.isScope(block)) this.setInspectedId(blockId);
  }

  selectConnection(connectionId: string, additive = false): void {
    if (!this.diagram.getConnection(connectionId)) return;
    this.disarmPalette();
    this.setSelectedOutput(undefined);
    this.setSelection(this.selection().selectConnection(connectionId, additive));
  }

  clearSelection(): void {
    this.setSelectedOutput(undefined);
    this.setSelection(DiagramSelection.empty());
  }

  deleteSelected(): void {
    const selection = this.selection();
    if (selection.size === 0) return;
    this.onDelete?.();
    this.clearGesture();
    this.setMoving(undefined);
    const connections = new Set(selection.connections());
    for (const connection of this.diagram.getConnections()) {
      if (selection.hasBlock(connection.from.blockId) || selection.hasBlock(connection.to.blockId)) connections.add(connection.id);
    }
    for (const id of connections) {
      this.diagram.disconnect(id);
      this.router.removeLink(id);
      this.routeMap.delete(id);
    }
    for (const id of selection.blocks()) {
      this.diagram.removeBlock(id);
      this.router.removeBlock(id);
      if (this.inspectedId() === id) this.closeInspection();
      if (this.configuredId() === id) this.closeConfiguration();
    }
    this.clearSelection();
    for (const block of this.diagram.getBlocks()) this.router.upsertBlock(block);
    this.setRoutes([...this.routeMap.values()]);
    this.publishPlaced();
  }

  keyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || this.configuredId()) return;
    if (event.composedPath().some((target) => target instanceof HTMLElement
      && (target.isContentEditable || target.matches("input, textarea, select, [role=textbox]")))) return;
    if (event.key === "Escape") {
      this.clearSelection();
      this.disarmPalette();
    } else if ((event.key === "Delete" || event.key === "Backspace") && this.selection().size > 0) {
      event.preventDefault();
      this.deleteSelected();
    }
  }

  private disarmPalette(): void {
    this.arm.clear();
    this.setArmedId(undefined);
  }

  closeInspection(): void {
    this.setInspectedId(undefined);
  }

  openConfiguration(blockId: string): void {
    const block = this.diagram.getBlock(blockId);
    if (!block || block.definition.config.size === 0) return;
    this.setSelectedOutput(undefined);
    this.setConfiguredId(blockId);
  }

  closeConfiguration(): void {
    this.setConfiguredId(undefined);
  }

  noteConfiguration(): void {
    this.setConfigRevision(this.configRevision() + 1);
  }

  private connect(from: PortHit, to: PortHit): boolean {
    const connection = this.connector.tryConnect(from, to);
    if (!connection) return false;
    this.publishPlaced();
    this.acceptRoute(this.provisional(connection));
    this.router.addLink(connection);
    return true;
  }

  anchor(blockId: string, side: "input" | "output", portId: string, vectorIndex?: number): WirePoint | undefined {
    const block = this.diagram.getBlock(blockId);
    if (!block) return undefined;
    return PlacedBlock.from(block, this.diagram.getConnections()).anchor(side, portId, vectorIndex);
  }

  private begin(gesture: PointerGesture): void {
    this.gesture = gesture;
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerFinish);
    window.addEventListener("pointercancel", this.onPointerFinish);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.gesture?.move(event);
  };

  private readonly onPointerFinish = (event: PointerEvent): void => {
    const gesture = this.gesture;
    this.clearGesture();
    gesture?.finish(event);
  };

  private clearGesture(): void {
    this.gesture = undefined;
    if (typeof window === "undefined") return;
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerFinish);
    window.removeEventListener("pointercancel", this.onPointerFinish);
  }

  private acceptRoute(route: WireRoute): void {
    if (!this.diagram.getConnection(route.connectionId)) return;
    this.routeMap.set(route.connectionId, route);
    this.setRoutes([...this.routeMap.values()]);
  }

  private provisional(connection: Connection): WireRoute {
    const from = this.anchor(connection.from.blockId, "output", connection.from.portId, connection.from.vectorIndex) ?? new WirePoint(0, 0);
    const to = this.anchor(connection.to.blockId, "input", connection.to.portId, connection.to.vectorIndex) ?? new WirePoint(0, 0);
    return new WireRoute(connection.id, OrthogonalRoute.between(from, to), "provisional");
  }

  private refreshProvisional(blockId: string): void {
    let changed = false;
    for (const connection of this.diagram.getConnectionsForBlock(blockId)) {
      const current = this.routeMap.get(connection.id);
      if (current && current.origin !== "provisional") continue;
      this.routeMap.set(connection.id, this.provisional(connection));
      changed = true;
    }
    if (changed) this.setRoutes([...this.routeMap.values()]);
  }

  private publishPlaced(): void {
    const connections = this.diagram.getConnections();
    this.setPlaced(this.diagram.getBlocks().map((block) => PlacedBlock.from(block, connections)));
  }
}
