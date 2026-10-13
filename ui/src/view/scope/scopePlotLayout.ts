import type { ScopePlotGeometry, ScopeSeriesGeometry } from "./scopePlotGeometry.js";

/** Shared axes and SVG paths read directly from the scope's fixed data window. */
export class ScopePlotLayout {
  readonly left = 52;
  readonly top = 14;
  readonly right: number;
  readonly bottom: number;

  constructor(readonly width: number, readonly height: number) {
    this.right = Math.max(this.left + 1, width - 14);
    this.bottom = Math.max(this.top + 1, height - 26);
  }

  private x(time: number, domain: number): number {
    const span = Math.max(domain, Number.EPSILON);
    const ratio = Math.min(1, Math.max(0, time / span));
    return this.left + ratio * (this.right - this.left);
  }

  private y(value: number, minimum: number, maximum: number): number {
    const span = maximum - minimum || 1;
    const ratio = (value - minimum) / span;
    return this.bottom - ratio * (this.bottom - this.top);
  }

  gridPath(): string {
    let path = "";
    for (let index = 0; index <= 4; index += 1) {
      const y = this.top + ((this.bottom - this.top) * index) / 4;
      const x = this.left + ((this.right - this.left) * index) / 4;
      path += `M${this.left} ${y}H${this.right}M${x} ${this.top}V${this.bottom}`;
    }
    return path;
  }

  tracePath(geometry: ScopePlotGeometry, series: ScopeSeriesGeometry): string {
    if (series.buffer.size === 0) return "";
    let path = "";
    let connected = false;
    const emit = (index: number) => {
      const value = series.buffer.at(index);
      const x = this.x(geometry.sampleTime(series, index), geometry.axisSeconds).toFixed(2);
      const y = this.y(value, geometry.minimum, geometry.maximum).toFixed(2);
      if (!connected) path += `M${x} ${y}`;
      path += `L${x} ${y}`;
      connected = true;
    };
    const flush = (first: number, last: number, minimum: number, maximum: number) => {
      if (first === -1) return;
      emit(first);
      const early = Math.min(minimum, maximum);
      const late = Math.max(minimum, maximum);
      if (early !== first && early !== last) emit(early);
      if (late !== early && late !== first && late !== last) emit(late);
      if (last !== first) emit(last);
    };
    // Preserve each pixel bucket's endpoints and extrema, in sample order.
    // The stored samples are untouched and no point arrays are allocated.
    const bucketSize = Math.max(1, Math.ceil(series.buffer.capacity / Math.max(1, Math.floor(this.right - this.left))));
    for (let start = series.buffer.capacity - series.buffer.size; start < series.buffer.capacity; start += bucketSize) {
      const end = Math.min(series.buffer.capacity, start + bucketSize);
      let first = -1;
      let last = -1;
      let minimum = -1;
      let maximum = -1;
      let low = Infinity;
      let high = -Infinity;
      for (let index = start; index < end; index++) {
        const value = series.buffer.at(index);
        if (!Number.isFinite(value)) {
          flush(first, last, minimum, maximum);
          first = -1;
          low = Infinity;
          high = -Infinity;
          connected = false;
          continue;
        }
        if (first === -1) first = index;
        last = index;
        if (value < low) { low = value; minimum = index; }
        if (value > high) { high = value; maximum = index; }
      }
      flush(first, last, minimum, maximum);
    }
    return path;
  }
}
