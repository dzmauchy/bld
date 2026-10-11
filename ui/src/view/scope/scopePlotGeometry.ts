import type { ScopeChannelTrace, ScopeMonitor } from "./scopeCapture.js";

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
    readonly samples: readonly number[],
  ) {}

  static fromTrace(trace: ScopeChannelTrace, index: number): ScopeSeriesGeometry {
    return new ScopeSeriesGeometry(trace.channel, trace.label, ScopeSeriesStyle.color(index), trace.values());
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

  /**
   * Seconds shown on the shared time axis.
   * The axis grows with the samples until it reaches the scope period, then the trace scrolls.
   */
  get axisSeconds(): number {
    let span = 0;
    for (const series of this.series) {
      if (series.samples.length > 1) span = Math.max(span, (series.samples.length - 1) * this.sampleSeconds);
    }
    if (span <= 0) return this.domainSeconds;
    return Math.min(this.domainSeconds, span);
  }

  /** Smallest and largest finite samples, without axis padding. */
  sampleExtent(): { minimum: number; maximum: number } | undefined {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const series of this.series) {
      for (const value of series.samples) {
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
    const age = (series.samples.length - 1 - index) * this.sampleSeconds;
    return this.axisSeconds - age;
  }

  private static range(series: readonly ScopeSeriesGeometry[]): { minimum: number; maximum: number } {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const item of series) {
      for (const value of item.samples) {
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
