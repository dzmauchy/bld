import { WirePoint, WirePolyline } from "./geometry.js";

export type WireOrigin = "avoid" | "fallback" | "provisional";

/** A connector path ready to draw. */
export class WireRoute {
  constructor(
    readonly connectionId: string,
    readonly points: readonly WirePoint[],
    readonly origin: WireOrigin,
  ) {}

  get pointsAttribute(): string {
    return WirePolyline.pointsAttribute(this.points);
  }
}
