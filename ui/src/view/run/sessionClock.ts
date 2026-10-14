/** Wasm session calls the diagram runner needs while a diagram is running. */
export interface RunningSession {
  emitGpioIn(blockId: number, pinIndex: number, value: boolean): Promise<number>;
  setNow(ms: number): Promise<number>;
  tick(): Promise<number>;
  close(): Promise<number>;
  activeIntervalCount(): Promise<number>;
  intervalPeriodAt(index: number): Promise<number>;
}

export interface RunningRuntime {
  instantiate(wasm: Uint8Array): Promise<RunningSession>;
  close(): Promise<void>;
}

/** Smallest active source interval, which is how often the diagram should tick. */
export class IntervalSchedule {
  static async milliseconds(session: Pick<RunningSession, "activeIntervalCount" | "intervalPeriodAt">): Promise<number | undefined> {
    const count = await session.activeIntervalCount();
    let period: number | undefined;
    for (let index = 0; index < count; index += 1) {
      const value = await session.intervalPeriodAt(index);
      if (value > 0) period = period === undefined ? value : Math.min(period, value);
    }
    return period;
  }
}

/** Starts and stops the loop that advances diagram time. */
export abstract class SessionClock {
  abstract start(): void;
  abstract stop(): void;
}

/** Advances simulation time in uniform source intervals, independent of drawing and RPC delays. */
export class SimulationClock extends SessionClock {
  private stopped = true;
  private busy = false;
  private elapsedMilliseconds = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly session: RunningSession,
    private readonly periodMs: number,
    private readonly onTick: () => void,
    private readonly onError: (error: unknown) => void,
  ) {
    super();
  }

  override start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.elapsedMilliseconds = 0;
    this.timer = setInterval(() => { void this.step(); }, this.periodMs);
  }

  override stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async step(): Promise<void> {
    if (this.stopped || this.busy) return;
    this.busy = true;
    try {
      // Scope buffers place samples at their configured interval. Wall-clock
      // jumps here compress missed time into one plotted sample and distort the signal.
      this.elapsedMilliseconds += this.periodMs;
      await this.session.setNow(Math.round(this.elapsedMilliseconds));
      if (this.stopped) return;
      await this.session.tick();
      if (this.stopped) return;
      this.onTick();
    } catch (error) {
      this.stop();
      this.onError(error);
    } finally {
      this.busy = false;
    }
  }
}
