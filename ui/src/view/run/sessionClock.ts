/** Wasm session calls the diagram runner needs while a diagram is running. */
export interface RunningSession {
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

/** Advances wasm time from the wall clock and ticks every source interval. */
export class SimulationClock extends SessionClock {
  private stopped = true;
  private origin = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly session: RunningSession,
    private readonly periodMs: number,
    private readonly onTick: () => void,
    private readonly onError: (error: unknown) => void,
  ) {
    super();
  }

  override start(): void {
    this.stopped = false;
    this.origin = clockNow();
    this.schedule(this.periodMs);
  }

  override stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delay: number): void {
    this.timer = setTimeout(() => {
      void this.step();
    }, delay);
  }

  private async step(): Promise<void> {
    if (this.stopped) return;
    const started = clockNow();
    try {
      await this.session.setNow(Math.max(0, Math.round(started - this.origin)));
      await this.session.tick();
      this.onTick();
    } catch (error) {
      this.stop();
      this.onError(error);
      return;
    }
    if (this.stopped) return;
    this.schedule(Math.max(0, this.periodMs - (clockNow() - started)));
  }
}

function clockNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
