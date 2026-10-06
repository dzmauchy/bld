/** A point in diagram-canvas coordinates. */
export class WirePoint {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}

/** Pointer travel used to tell a click from a drag. */
export class PointerTravel {
  constructor(
    private readonly originX: number,
    private readonly originY: number,
    private readonly threshold = 4,
  ) {}

  moved(x: number, y: number): boolean {
    return Math.hypot(x - this.originX, y - this.originY) >= this.threshold;
  }
}

/** Client coordinates translated into a diagram canvas. */
export class CanvasPoint {
  static relative(rect: Pick<DOMRect, "left" | "top">, clientX: number, clientY: number): WirePoint {
    return new WirePoint(clientX - rect.left, clientY - rect.top);
  }

  static inside(rect: Pick<DOMRect, "left" | "right" | "top" | "bottom">, clientX: number, clientY: number): boolean {
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  /** Top-left of a block centered on `point`, clamped so it stays on the canvas. */
  static centered(point: WirePoint, width: number, height: number): WirePoint {
    return new WirePoint(Math.max(0, Math.round(point.x - width / 2)), Math.max(0, Math.round(point.y - height / 2)));
  }
}

/** Orthogonal elbow used before the avoid router publishes a path. */
export class OrthogonalRoute {
  static between(from: WirePoint, to: WirePoint): WirePoint[] {
    if (Math.abs(from.x - to.x) < 0.5 || Math.abs(from.y - to.y) < 0.5) return [from, to];
    const mid = from.x + (to.x - from.x) / 2;
    return [from, new WirePoint(mid, from.y), new WirePoint(mid, to.y), to];
  }
}

export class WirePolyline {
  static pointsAttribute(points: readonly WirePoint[]): string {
    return points.map((point) => `${point.x},${point.y}`).join(" ");
  }
}

/** Floating preview of a palette block following the pointer. */
export class DragGhost {
  constructor(
    readonly title: string,
    readonly x: number,
    readonly y: number,
    readonly width: number,
    readonly height: number,
    readonly accentClass: string,
  ) {}
}
