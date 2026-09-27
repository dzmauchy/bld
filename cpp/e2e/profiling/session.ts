/** Execution profiling session and metric management. */

import type { IProfileTimer } from "./timer.ts";
import { PerformanceProfileTimer } from "./timer.ts";

export interface IProfileMetric {
  readonly phase: string;
  readonly name: string;
  readonly durationMs: number;
  readonly isSubMetric?: boolean;
  readonly details?: Record<string, unknown>;
}

export class ProfileMetric implements IProfileMetric {
  constructor(
    private readonly _phase: string,
    private readonly _name: string,
    private readonly _durationMs: number,
    private readonly _isSubMetric: boolean = false,
    private readonly _details?: Record<string, unknown>,
  ) {}

  get phase(): string {
    return this._phase;
  }

  get name(): string {
    return this._name;
  }

  get durationMs(): number {
    return this._durationMs;
  }

  get isSubMetric(): boolean {
    return this._isSubMetric;
  }

  get details(): Record<string, unknown> | undefined {
    return this._details;
  }
}

export interface IProfileSession {
  readonly name: string;
  readonly metrics: readonly IProfileMetric[];
  record(
    phase: string,
    name: string,
    durationMs: number,
    isSubMetric?: boolean,
    details?: Record<string, unknown>,
  ): void;
  measure<T>(
    phase: string,
    name: string,
    task: () => Promise<T>,
    details?: Record<string, unknown>,
  ): Promise<T>;
  measureSync<T>(
    phase: string,
    name: string,
    task: () => T,
    details?: Record<string, unknown>,
  ): T;
  totalDurationMs(): number;
  metricsForPhase(phase: string): readonly IProfileMetric[];
}

export class ExecutionProfileSession implements IProfileSession {
  private readonly _metrics: ProfileMetric[] = [];

  constructor(
    private readonly _name: string,
    private readonly createTimer: () => IProfileTimer = () => new PerformanceProfileTimer(),
  ) {}

  get name(): string {
    return this._name;
  }

  get metrics(): readonly IProfileMetric[] {
    return this._metrics;
  }

  record(
    phase: string,
    name: string,
    durationMs: number,
    isSubMetric = false,
    details?: Record<string, unknown>,
  ): void {
    this._metrics.push(new ProfileMetric(phase, name, durationMs, isSubMetric, details));
  }

  async measure<T>(
    phase: string,
    name: string,
    task: () => Promise<T>,
    details?: Record<string, unknown>,
  ): Promise<T> {
    const timer = this.createTimer();
    timer.start();
    try {
      return await task();
    } finally {
      const elapsed = timer.stop();
      this.record(phase, name, elapsed, false, details);
    }
  }

  measureSync<T>(
    phase: string,
    name: string,
    task: () => T,
    details?: Record<string, unknown>,
  ): T {
    const timer = this.createTimer();
    timer.start();
    try {
      return task();
    } finally {
      const elapsed = timer.stop();
      this.record(phase, name, elapsed, false, details);
    }
  }

  totalDurationMs(): number {
    return this._metrics
      .filter((m) => !m.isSubMetric)
      .reduce((acc, m) => acc + m.durationMs, 0);
  }

  metricsForPhase(phase: string): readonly IProfileMetric[] {
    return this._metrics.filter((m) => m.phase === phase);
  }
}
