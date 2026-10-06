import type { BlockDefinition } from "core";
import { BlockAccent } from "../palette/palettePresenter.js";
import { CanvasPoint, DragGhost, OrthogonalRoute, PointerTravel, WirePoint } from "./geometry.js";
import { DiagramBlockFrame } from "./diagramBlockFrame.js";
import { PortHit } from "./diagramConnector.js";

export interface DiagramGestureHost {
  canvasElement(): HTMLElement | undefined;
  armDefinition(definition: BlockDefinition): void;
  armedDefinition(): BlockDefinition | undefined;
  place(definition: BlockDefinition, clientX: number, clientY: number): void;
  showGhost(ghost: DragGhost | undefined): void;
  setReceiving(active: boolean): void;
  moveBlock(blockId: string, x: number, y: number): void;
  blockOrigin(blockId: string): WirePoint | undefined;
  setMoving(blockId: string | undefined): void;
  connect(from: PortHit, to: PortHit): void;
  setDraft(points: readonly WirePoint[] | undefined): void;
  anchor(blockId: string, side: "input" | "output", portId: string): WirePoint | undefined;
}

export abstract class PointerGesture {
  abstract move(event: PointerEvent): void;
  abstract finish(event: PointerEvent): void;
}

export class PaletteDragGesture extends PointerGesture {
  private readonly travel: PointerTravel;
  private dragging = false;

  constructor(
    private readonly host: DiagramGestureHost,
    private readonly definition: BlockDefinition,
    event: PointerEvent,
  ) {
    super();
    this.travel = new PointerTravel(event.clientX, event.clientY);
  }

  override move(event: PointerEvent): void {
    if (!this.dragging && !this.travel.moved(event.clientX, event.clientY)) return;
    this.dragging = true;
    const frame = DiagramBlockFrame.forDefinition(this.definition);
    this.host.showGhost(
      new DragGhost(
        this.definition.title,
        event.clientX,
        event.clientY,
        frame.width,
        frame.height,
        BlockAccent.forCategory(this.definition.category).className,
      ),
    );
    const canvas = this.host.canvasElement();
    this.host.setReceiving(Boolean(canvas && CanvasPoint.inside(canvas.getBoundingClientRect(), event.clientX, event.clientY)));
  }

  override finish(event: PointerEvent): void {
    this.host.showGhost(undefined);
    this.host.setReceiving(false);
    if (!this.dragging) {
      this.host.armDefinition(this.definition);
      return;
    }
    this.host.place(this.definition, event.clientX, event.clientY);
  }
}

export class BlockMoveGesture extends PointerGesture {
  private readonly origin: WirePoint;
  private readonly pointerX: number;
  private readonly pointerY: number;

  constructor(
    private readonly host: DiagramGestureHost,
    private readonly blockId: string,
    event: PointerEvent,
  ) {
    super();
    this.origin = host.blockOrigin(blockId) ?? new WirePoint(0, 0);
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    host.setMoving(blockId);
  }

  override move(event: PointerEvent): void {
    this.host.moveBlock(this.blockId, this.origin.x + event.clientX - this.pointerX, this.origin.y + event.clientY - this.pointerY);
  }

  override finish(): void {
    this.host.setMoving(undefined);
  }
}

export class PortWireGesture extends PointerGesture {
  private readonly origin: WirePoint;

  constructor(
    private readonly host: DiagramGestureHost,
    private readonly from: PortHit,
    event: PointerEvent,
  ) {
    super();
    this.origin = host.anchor(from.blockId, from.side, from.portId) ?? new WirePoint(0, 0);
    this.move(event);
  }

  override move(event: PointerEvent): void {
    const canvas = this.host.canvasElement();
    if (!canvas) return;
    const point = CanvasPoint.relative(canvas.getBoundingClientRect(), event.clientX, event.clientY);
    this.host.setDraft(OrthogonalRoute.between(this.origin, point));
  }

  override finish(event: PointerEvent): void {
    this.host.setDraft(undefined);
    const hit = PortHit.fromPoint(event.clientX, event.clientY);
    if (!hit) return;
    this.host.connect(this.from, hit);
  }
}

export class StampGesture extends PointerGesture {
  private readonly travel: PointerTravel;
  private dragged = false;

  constructor(
    private readonly host: DiagramGestureHost,
    event: PointerEvent,
  ) {
    super();
    this.travel = new PointerTravel(event.clientX, event.clientY);
  }

  override move(event: PointerEvent): void {
    if (this.travel.moved(event.clientX, event.clientY)) this.dragged = true;
  }

  override finish(event: PointerEvent): void {
    if (this.dragged || !this.host.armedDefinition()) return;
    const canvas = this.host.canvasElement();
    if (!canvas || !CanvasPoint.inside(canvas.getBoundingClientRect(), event.clientX, event.clientY)) return;
    const target = typeof document === "undefined" ? null : document.elementFromPoint(event.clientX, event.clientY);
    if (!PortHit.isBackground(target)) return;
    const definition = this.host.armedDefinition();
    if (!definition) return;
    this.host.place(definition, event.clientX, event.clientY);
  }
}
