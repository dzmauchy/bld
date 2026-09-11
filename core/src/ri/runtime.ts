import type { ExecutionContext, f32, f64, u16, u32, u64, u8 } from "./context";

export interface IntervalRegistration {
  id: number;
  period: number;
  callback: () => void;
}

export interface GpioRegistration {
  id: number;
  port: number;
  callback: (pin: u8, v: boolean) => void;
}

/**
 * Object-oriented ExecutionContext implementation for the reference implementation (RI).
 * Encapsulates timers, GPIO listeners, pin memory, lifecycle hooks, and math functions.
 */
export class RiExecutionContext implements ExecutionContext {
  private readonly onStartCallbacks: Array<() => void> = [];
  private readonly onCloseCallbacks: Array<() => void> = [];
  private readonly intervals = new Map<number, IntervalRegistration>();
  private readonly gpioListeners = new Map<number, GpioRegistration>();
  private readonly pinValues = new Map<string, number>();
  private _pinWriteCount = 0;
  private currentTime: bigint = 0n;
  private randomValue = 0.5;
  private nextIntervalId = 1;
  private nextGpioId = 1;
  private closed = false;
  private started = false;

  private pinKey(blockId: number, pin: number): string {
    return `${blockId}_${pin}`;
  }

  // --- ExecutionContext System Contracts ---

  onStart(callback: () => void): void {
    if (this.closed) return;
    this.onStartCallbacks.push(callback);
    if (this.started) {
      callback();
    }
  }

  onClose(callback: () => void): void {
    if (this.closed) return;
    this.onCloseCallbacks.push(callback);
  }

  setGPIO(port: u16, callback: (pin: u8, v: boolean) => void): u32 {
    if (this.closed) return 0;
    const id = this.nextGpioId++;
    this.gpioListeners.set(id, { id, port, callback });
    return id;
  }

  clearGPIO(id: u32): void {
    this.gpioListeners.delete(id);
  }

  setInterval(period: u32, callback: () => void): u32 {
    if (this.closed) return 0;
    const id = this.nextIntervalId++;
    this.intervals.set(id, { id, period, callback });
    return id;
  }

  clearInterval(id: u32): void {
    this.intervals.delete(id);
  }

  sendF32(blockId: u32, pin: u8, v: f32): void {
    if (this.closed) return;
    this.pinValues.set(this.pinKey(blockId, pin), Math.fround(v));
    this._pinWriteCount++;
  }

  sendF64(blockId: u32, pin: u8, v: f64): void {
    if (this.closed) return;
    this.pinValues.set(this.pinKey(blockId, pin), v);
    this._pinWriteCount++;
  }

  sin32(v: f32): f32 {
    return Math.fround(Math.sin(v));
  }

  cos32(v: f32): f32 {
    return Math.fround(Math.cos(v));
  }

  sin64(v: f64): f64 {
    return Math.sin(v);
  }

  cos64(v: f64): f64 {
    return Math.cos(v);
  }

  sqrt32(v: f32): f32 {
    return Math.fround(Math.sqrt(v));
  }

  sqrt64(v: f64): f64 {
    return Math.sqrt(v);
  }

  pow32(v: f32, exp: f32): f32 {
    return Math.fround(Math.pow(v, exp));
  }

  pow64(v: f64, exp: f64): f64 {
    return Math.pow(v, exp);
  }

  random32(): f32 {
    return Math.fround(this.randomValue);
  }

  random64(): f64 {
    return this.randomValue;
  }

  now(): u64 {
    return this.currentTime;
  }

  // --- Driver & Control Methods for Lifecycle & Testing ---

  start(): void {
    if (this.closed || this.started) return;
    this.started = true;
    for (const callback of [...this.onStartCallbacks]) {
      callback();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const callback of [...this.onCloseCallbacks]) {
      callback();
    }
    this.intervals.clear();
    this.gpioListeners.clear();
  }

  isClosed(): boolean {
    return this.closed;
  }

  isStarted(): boolean {
    return this.started;
  }

  tick(advanceMs = 0): void {
    if (this.closed) return;
    if (advanceMs > 0) {
      this.currentTime += BigInt(advanceMs);
    }
    const currentIntervals = [...this.intervals.values()];
    for (const interval of currentIntervals) {
      if (!this.intervals.has(interval.id)) continue;
      interval.callback();
    }
  }

  tickThenObserve(): void {
    this.tick();
    this.clearPins();
    this.tick();
  }

  emitGpio(port: number, pin: number, value: boolean): void {
    if (this.closed) return;
    for (const listener of [...this.gpioListeners.values()]) {
      if (listener.port === port) {
        listener.callback(pin, value);
      }
    }
  }

  setNow(ms: number | bigint): void {
    this.currentTime = BigInt(ms);
  }

  setRandom(value: number): void {
    this.randomValue = value;
  }

  lastPin(blockId: number, pin: number): number {
    return this.pinValues.get(this.pinKey(blockId, pin)) ?? Number.NaN;
  }

  hasPin(blockId: number, pin: number): boolean {
    return this.pinValues.has(this.pinKey(blockId, pin));
  }

  clearPins(): void {
    this.pinValues.clear();
    this._pinWriteCount = 0;
  }

  pinWriteCount(): number {
    return this._pinWriteCount;
  }

  activeIntervalCount(): number {
    return this.intervals.size;
  }

  intervalPeriodAt(index: number): number {
    const list = [...this.intervals.values()];
    return list[index]?.period ?? 0;
  }

  activeGpioListenerCount(): number {
    return this.gpioListeners.size;
  }
}
