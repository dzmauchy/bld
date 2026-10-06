import { Diagram, type BlockDefinition, type Connection } from "core";
import { createSignal, type Accessor } from "solid-js";
import { AvoidWireRouter, type WireRouter } from "./avoidWireRouter.js";
import { CanvasPoint, DragGhost, OrthogonalRoute, WirePoint } from "./geometry.js";
import { DiagramBlockFrame, PlacedBlock } from "./diagramBlockFrame.js";
import { DiagramConnector, PortHit } from "./diagramConnector.js";
import { BlockMoveGesture, PaletteDragGesture, PointerGesture, PortWireGesture, StampGesture, type DiagramGestureHost } from "./diagramGestures.js";
import { PaletteArm } from "./paletteArm.js";
import { WireRoute } from "./wireRoute.js";

/** Canvas session: palette drag, click-to-insert, block moves, and connector drags. */
export class DiagramEditor implements DiagramGestureHost {
  private readonly connector: DiagramConnector;
  private readonly arm = new PaletteArm();
  private canvas: HTMLElement | undefined;
  private gesture: PointerGesture | undefined;

  readonly placed: Accessor<readonly PlacedBlock[]>;
  private readonly setPlaced: (blocks: readonly PlacedBlock[]) => void;
  readonly routes: Accessor<readonly WireRoute[]>;
  private readonly setRoutes: (routes: readonly WireRoute[]) => void;
  readonly armedId: Accessor<string | undefined>;
  private readonly setArmedId: (id: string | undefined) => void;
  readonly ghost: Accessor<DragGhost | undefined>;
  private readonly setGhost: (ghost: DragGhost | undefined) => void;
  readonly receiving: Accessor<boolean>;
  private readonly setReceivingSignal: (active: boolean) => void;
  readonly movingId: Accessor<string | undefined>;
  private readonly setMovingId: (id: string | undefined) => void;
  readonly draft: Accessor<readonly WirePoint[] | undefined>;
  private readonly setDraftPoints: (points: readonly WirePoint[] | undefined) => void;

  private readonly routeMap = new Map<string, WireRoute>();

  private readonly router: WireRouter;

  constructor(
    private readonly diagram: Diagram,
    router?: WireRouter,
  ) {
    this.connector = new DiagramConnector(diagram);
    const placed = createSignal<readonly PlacedBlock[]>([]);
    this.placed = placed[0];
    this.setPlaced = placed[1];
    const routes = createSignal<readonly WireRoute[]>([]);
    this.routes = routes[0];
    this.setRoutes = routes[1];
    const armed = createSignal<string | undefined>();
    this.armedId = armed[0];
    this.setArmedId = armed[1];
    const ghost = createSignal<DragGhost | undefined>();
    this.ghost = ghost[0];
    this.setGhost = ghost[1];
    const receiving = createSignal(false);
    this.receiving = receiving[0];
    this.setReceivingSignal = receiving[1];
    const moving = createSignal<string | undefined>();
    this.movingId = moving[0];
    this.setMovingId = moving[1];
    const draft = createSignal<readonly WirePoint[] | undefined>();
    this.draft = draft[0];
    this.setDraftPoints = draft[1];
    this.router = router ?? new AvoidWireRouter((route) => this.acceptRoute(route));
  }

  start(): void {
    this.router.start();
  }

  destroy(): void {
    this.clearGesture();
    this.router.destroy();
  }

  attachCanvas(canvas: HTMLElement | undefined): void {
    this.canvas = canvas;
  }

  canvasElement(): HTMLElement | undefined {
    return this.canvas;
  }

  palettePointerDown(definition: BlockDefinition, event: PointerEvent): void {
    if (event.button !== 0 || this.gesture) return;
    this.begin(new PaletteDragGesture(this, definition, event));
  }

  canvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || this.gesture) return;
    const port = PortHit.fromTarget(event.target);
    if (port) {
      event.preventDefault();
      this.begin(new PortWireGesture(this, port, event));
      return;
    }
    const blockId = PortHit.blockIdFromTarget(event.target);
    if (blockId) {
      event.preventDefault();
      this.begin(new BlockMoveGesture(this, blockId, event));
      return;
    }
    if (PortHit.isBackground(event.target)) {
      event.preventDefault();
      this.begin(new StampGesture(this, event));
    }
  }

  armDefinition(definition: BlockDefinition): void {
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

  showGhost(ghost: DragGhost | undefined): void {
    this.setGhost(ghost);
  }

  setReceiving(active: boolean): void {
    this.setReceivingSignal(active);
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

  connect(from: PortHit, to: PortHit): void {
    const connection = this.connector.tryConnect(from, to);
    if (!connection) return;
    this.acceptRoute(this.provisional(connection));
    this.router.addLink(connection);
  }

  setDraft(points: readonly WirePoint[] | undefined): void {
    this.setDraftPoints(points);
  }

  anchor(blockId: string, side: "input" | "output", portId: string): WirePoint | undefined {
    const block = this.diagram.getBlock(blockId);
    if (!block) return undefined;
    return PlacedBlock.from(block).anchor(side, portId);
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
    this.routeMap.set(route.connectionId, route);
    this.setRoutes([...this.routeMap.values()]);
  }

  private provisional(connection: Connection): WireRoute {
    const from = this.anchor(connection.from.blockId, "output", connection.from.portId) ?? new WirePoint(0, 0);
    const to = this.anchor(connection.to.blockId, "input", connection.to.portId) ?? new WirePoint(0, 0);
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
    this.setPlaced(this.diagram.getBlocks().map((block) => PlacedBlock.from(block)));
  }
}
