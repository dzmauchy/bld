import type { ScopeChannelTrace, ScopeChannelWindow, ScopeMonitor } from "./scopeCapture.js";

/** Stroke colors for scope channels drawn on one pair of axes. */
export class ScopeSeriesStyle {
  static readonly palette = ["#6ea8ff", "#ffb020", "#3ddc97", "#ff6b6b", "#c084fc", "#22d3ee", "#f472b6", "#f8fafc"];

  static color(index: number): string {
    return ScopeSeriesStyle.palette[index % ScopeSeriesStyle.palette.length] ?? "#6ea8ff";
  }

  static label(value: number): string {
    if (!Number.isFinite(value)) return "";
    const abs = Math.abs(value);
    if (abs !== 0 && (abs < 0.01 || abs >= 1000)) return value.toExponential(1);
    return String(Math.round(value * 100) / 100);
  }
}

/** One channel's samples, oldest first, in the shared time window. */
export class ScopeSeriesGeometry {
  constructor(
    readonly channel: number,
    readonly label: string,
    readonly color: string,
    readonly buffer: ScopeChannelWindow,
  ) {}

  static fromTrace(trace: ScopeChannelTrace, index: number): ScopeSeriesGeometry {
    return new ScopeSeriesGeometry(trace.channel, trace.label, ScopeSeriesStyle.color(index), trace.buffer);
  }
}

/**
 * Shared axes for every output of a scope.
 * Time runs across the scope period, and every channel uses the same value range.
 * The newest sample of each channel sits on the right edge so the trace scrolls.
 */
export class ScopePlotGeometry {
  constructor(
    readonly domainSeconds: number,
    readonly sampleSeconds: number,
    readonly minimum: number,
    readonly maximum: number,
    readonly series: readonly ScopeSeriesGeometry[],
  ) {}

  static fromMonitor(monitor: ScopeMonitor): ScopePlotGeometry {
    const series = monitor.series().map((trace, index) => ScopeSeriesGeometry.fromTrace(trace, index));
    const range = ScopePlotGeometry.range(series);
    return new ScopePlotGeometry(monitor.domainSeconds, monitor.sampleSeconds, range.minimum, range.maximum, series);
  }

  /** The full configured period is always visible, including unused NaN slots. */
  get axisSeconds(): number {
    return this.domainSeconds;
  }

  /** Smallest and largest finite samples, without axis padding. */
  sampleExtent(): { minimum: number; maximum: number } | undefined {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const series of this.series) {
      for (let index = 0; index < series.buffer.capacity; index++) {
        const value = series.buffer.at(index);
        if (!Number.isFinite(value)) continue;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    }
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return undefined;
    return { minimum, maximum };
  }

  /** Seconds from the left edge of the shared time axis. The newest sample is on the right. */
  sampleTime(series: ScopeSeriesGeometry, index: number): number {
    const age = (series.buffer.capacity - 1 - index) * this.sampleSeconds;
    return this.axisSeconds - age;
  }

  private static range(series: readonly ScopeSeriesGeometry[]): { minimum: number; maximum: number } {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const item of series) {
      for (let index = 0; index < item.buffer.capacity; index++) {
        const value = item.buffer.at(index);
        if (!Number.isFinite(value)) continue;
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
    }
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return { minimum: -1, maximum: 1 };
    if (minimum === maximum) {
      const pad = Math.max(Math.abs(minimum) * 0.1, 1);
      return { minimum: minimum - pad, maximum: maximum + pad };
    }
    const pad = (maximum - minimum) * 0.08;
    return { minimum: minimum - pad, maximum: maximum + pad };
  }
}
