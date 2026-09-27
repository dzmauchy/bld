/** High-resolution timer contracts and implementations for execution profiling. */

export interface IProfileTimer {
  start(): void;
  stop(): number;
  elapsed(): number;
}

export abstract class BaseProfileTimer implements IProfileTimer {
  protected startTime = 0;
  protected stopTime = 0;
  protected isRunning = false;

  abstract now(): number;

  start(): void {
    this.startTime = this.now();
    this.stopTime = 0;
    this.isRunning = true;
  }

  stop(): number {
    if (!this.isRunning) {
      return this.elapsed();
    }
    this.stopTime = this.now();
    this.isRunning = false;
    return this.elapsed();
  }

  elapsed(): number {
    if (this.isRunning) {
      return this.now() - this.startTime;
    }
    return Math.max(0, this.stopTime - this.startTime);
  }
}

export class PerformanceProfileTimer extends BaseProfileTimer {
  override now(): number {
    return performance.now();
  }
}
