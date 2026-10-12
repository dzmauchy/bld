import type { BlockDefinition } from "core";
import { CanvasPoint, PointerTravel, WirePoint } from "./geometry.js";
import { PortHit } from "./diagramConnector.js";

export interface DiagramGestureHost {
  canvasElement(): HTMLElement | undefined;
  armedDefinition(): BlockDefinition | undefined;
  place(definition: BlockDefinition, clientX: number, clientY: number): void;
  moveBlock(blockId: string, x: number, y: number): void;
  blockOrigin(blockId: string): WirePoint | undefined;
  setMoving(blockId: string | undefined): void;
  selectBlock(blockId: string, additive?: boolean): void;
}

export abstract class PointerGesture {
  abstract move(event: PointerEvent): void;
  abstract finish(event: PointerEvent): void;
}

export class BlockMoveGesture extends PointerGesture {
  private readonly origin: WirePoint;
  private readonly pointerX: number;
  private readonly pointerY: number;
  private readonly travel: PointerTravel;
  private dragged = false;

  constructor(
    private readonly host: DiagramGestureHost,
    private readonly blockId: string,
    event: PointerEvent,
  ) {
    super();
    this.origin = host.blockOrigin(blockId) ?? new WirePoint(0, 0);
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.travel = new PointerTravel(event.clientX, event.clientY);
  }

  override move(event: PointerEvent): void {
    if (!this.dragged && !this.travel.moved(event.clientX, event.clientY)) return;
    if (!this.dragged) this.host.setMoving(this.blockId);
    this.dragged = true;
    this.host.moveBlock(this.blockId, this.origin.x + event.clientX - this.pointerX, this.origin.y + event.clientY - this.pointerY);
  }

  override finish(event?: PointerEvent): void {
    this.host.setMoving(undefined);
    if (!this.dragged) this.host.selectBlock(this.blockId, Boolean(event?.shiftKey || event?.ctrlKey || event?.metaKey));
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
