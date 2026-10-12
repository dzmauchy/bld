import { ScopePlotGeometry, ScopeSeriesGeometry, ScopeSeriesStyle } from "./scopePlotGeometry.js";

/** Pixel rectangle of the shared axes, inside the canvas padding. */
class PlotArea {
  readonly left = 52;
  readonly top = 14;
  readonly right: number;
  readonly bottom: number;

  constructor(readonly width: number, readonly height: number) {
    this.right = Math.max(this.left + 1, width - 14);
    this.bottom = Math.max(this.top + 1, height - 26);
  }

  x(time: number, domain: number): number {
    const span = Math.max(domain, Number.EPSILON);
    const ratio = Math.min(1, Math.max(0, time / span));
    return this.left + ratio * (this.right - this.left);
  }

  y(value: number, minimum: number, maximum: number): number {
    const span = maximum - minimum || 1;
    const ratio = (value - minimum) / span;
    return this.bottom - ratio * (this.bottom - this.top);
  }
}

/** Draws every scope channel on one time axis and one value axis. */
export class ScopePlotPainter {
  paint(element: HTMLCanvasElement, geometry: ScopePlotGeometry, vintage = true): void {
    const rect = element.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    element.width = Math.max(1, Math.floor(width * dpr));
    element.height = Math.max(1, Math.floor(height * dpr));
    const context = element.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw(context, width, height, geometry, vintage);
  }

  draw(context: CanvasRenderingContext2D, width: number, height: number, geometry: ScopePlotGeometry, vintage = true): void {
    const area = new PlotArea(width, height);
    context.clearRect(0, 0, width, height);
    context.fillStyle = vintage ? "#08100e" : "#000000";
    context.fillRect(0, 0, width, height);
    this.grid(context, area);
    for (const series of geometry.series) this.stroke(context, area, geometry, series, vintage);
    this.frame(context, area, geometry);
  }

  private grid(context: CanvasRenderingContext2D, area: PlotArea): void {
    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.08)";
    context.lineWidth = 1;
    context.beginPath();
    for (let index = 0; index <= 4; index += 1) {
      const y = area.top + ((area.bottom - area.top) * index) / 4;
      context.moveTo(area.left, y);
      context.lineTo(area.right, y);
      const x = area.left + ((area.right - area.left) * index) / 4;
      context.moveTo(x, area.top);
      context.lineTo(x, area.bottom);
    }
    context.stroke();
    context.restore();
  }

  private frame(context: CanvasRenderingContext2D, area: PlotArea, geometry: ScopePlotGeometry): void {
    context.save();
    context.strokeStyle = "#3a3a3a";
    context.lineWidth = 1;
    context.strokeRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
    context.fillStyle = "#9aa0a6";
    context.font = "11px ui-sans-serif, system-ui, sans-serif";
    context.textBaseline = "top";
    context.textAlign = "left";
    context.fillText("0s", area.left, area.bottom + 6);
    context.textAlign = "right";
    context.fillText(`${ScopeSeriesStyle.label(geometry.axisSeconds)}s`, area.right, area.bottom + 6);
    context.textAlign = "right";
    context.textBaseline = "bottom";
    context.fillText(ScopeSeriesStyle.label(geometry.maximum), area.left - 6, area.top + 11);
    context.textBaseline = "top";
    context.fillText(ScopeSeriesStyle.label(geometry.minimum), area.left - 6, area.bottom - 11);
    context.restore();
  }

  private stroke(context: CanvasRenderingContext2D, area: PlotArea, geometry: ScopePlotGeometry, series: ScopeSeriesGeometry, vintage: boolean): void {
    if (series.buffer.size === 0) return;
    context.save();
    context.strokeStyle = series.color;
    context.fillStyle = series.color;
    context.lineWidth = 1.75;
    context.lineJoin = "round";
    context.lineCap = "round";
    if (vintage) {
      context.shadowColor = series.color;
      context.shadowBlur = 6;
      context.filter = "blur(0.35px)";
    }
    context.beginPath();
    let connected = false;
    let count = 0;
    let x = 0;
    let y = 0;
    for (let index = 0; index < series.buffer.capacity; index++) {
      const value = series.buffer.at(index);
      if (!Number.isFinite(value)) {
        connected = false;
        continue;
      }
      x = area.x(geometry.sampleTime(series, index), geometry.axisSeconds);
      y = area.y(value, geometry.minimum, geometry.maximum);
      if (!connected) context.moveTo(x, y);
      context.lineTo(x, y);
      connected = true;
      count++;
    }
    if (count === 1) {
      context.beginPath();
      context.arc(x, y, 2.5, 0, Math.PI * 2);
      context.fill();
    } else if (count > 1 && vintage) {
      context.save();
      context.globalAlpha = 0.25;
      context.lineWidth = 3.5;
      context.filter = "blur(1.5px)";
      context.shadowBlur = 10;
      context.stroke();
      context.restore();
    }
    if (count > 1) context.stroke();
    context.restore();
  }
}
