import {
  CloseHandler,
  DiscardF32,
  ExecutionContext,
  GpioInHandler,
  IntervalHandler,
  Pss,
  dest1,
  dest2,
  dest3,
  gpioSinks,
  gpioSinks3,
  pins,
  widths,
} from "./context";

export { DiscardF32, dest1, dest2, dest3, gpioSinks, gpioSinks3, pins, widths };

class IntervalEntry {
  id: u32;
  period: u32;
  handler: IntervalHandler;
  active: bool;

  constructor(id: u32, period: u32, handler: IntervalHandler) {
    this.id = id;
    this.period = period;
    this.handler = handler;
    this.active = true;
  }
}

class PinWrite {
  blockId: u32;
  pin: u8;
  value: f32;

  constructor(blockId: u32, pin: u8, value: f32) {
    this.blockId = blockId;
    this.pin = pin;
    this.value = value;
  }
}

class GpioListener {
  blockId: u32;
  handler: GpioInHandler;
  active: bool;

  constructor(blockId: u32, handler: GpioInHandler) {
    this.blockId = blockId;
    this.handler = handler;
    this.active = true;
  }
}

export class TestExecutionContext extends ExecutionContext {
  private nextIntervalId: u32 = 1;
  private nowMs: u64 = 0;
  private randomValue: f32 = 0.5;
  private intervals: Array<IntervalEntry> = new Array<IntervalEntry>();
  private closeHandlers: Array<CloseHandler> = new Array<CloseHandler>();
  private writes: Array<PinWrite> = new Array<PinWrite>();
  private gpioListeners: Array<GpioListener> = new Array<GpioListener>();

  setInterval(period: u32, handler: IntervalHandler): u32 {
    const id = this.nextIntervalId++;
    this.intervals.push(new IntervalEntry(id, period, handler));
    return id;
  }

  clearInterval(id: u32): void {
    for (let i = 0; i < this.intervals.length; i++) {
      if (this.intervals[i].id == id) {
        this.intervals[i].active = false;
      }
    }
  }

  onClose(handler: CloseHandler): void {
    this.closeHandlers.push(handler);
  }

  sendPinF32(blockId: u32, pin: u8, v: f32): void {
    this.writes.push(new PinWrite(blockId, pin, v));
  }

  cos(v: f32): f32 {
    return Mathf.cos(v);
  }

  sin(v: f32): f32 {
    return Mathf.sin(v);
  }

  tan(v: f32): f32 {
    return Mathf.tan(v);
  }

  random(): f32 {
    return this.randomValue;
  }

  now(): u64 {
    return this.nowMs;
  }

  listenGpioIn(blockId: u32, handler: GpioInHandler): void {
    this.gpioListeners.push(new GpioListener(blockId, handler));
  }

  unlistenGpioIn(blockId: u32): void {
    for (let i = 0; i < this.gpioListeners.length; i++) {
      if (this.gpioListeners[i].blockId == blockId) {
        this.gpioListeners[i].active = false;
      }
    }
  }

  setNow(ms: u64): void {
    this.nowMs = ms;
  }

  setRandom(value: f32): void {
    this.randomValue = value;
  }

  tick(): void {
    const snapshot = this.intervals.slice();
    for (let i = 0; i < snapshot.length; i++) {
      const interval = snapshot[i];
      if (interval.active) interval.handler.onInterval();
    }
  }

  close(): void {
    const handlers = this.closeHandlers.slice();
    for (let i = 0; i < handlers.length; i++) {
      handlers[i].onClose();
    }
  }

  emitGpioIn(blockId: u32, pinIndex: u8, value: bool): void {
    for (let i = 0; i < this.gpioListeners.length; i++) {
      const listener = this.gpioListeners[i];
      if (listener.active && listener.blockId == blockId) {
        listener.handler.onGpioIn(pinIndex, value);
      }
    }
  }

  lastPin(blockId: u32, pin: u8): f32 {
    for (let i = this.writes.length - 1; i >= 0; i--) {
      const write = this.writes[i];
      if (write.blockId == blockId && write.pin == pin) return write.value;
    }
    return f32.NaN;
  }

  hasPin(blockId: u32, pin: u8): bool {
    for (let i = 0; i < this.writes.length; i++) {
      if (this.writes[i].blockId == blockId && this.writes[i].pin == pin) return true;
    }
    return false;
  }

  pinWriteCount(): i32 {
    return this.writes.length;
  }

  clearPins(): void {
    this.writes.length = 0;
  }

  activeIntervalCount(): i32 {
    let count = 0;
    for (let i = 0; i < this.intervals.length; i++) {
      if (this.intervals[i].active) count++;
    }
    return count;
  }

  intervalPeriodAt(index: i32): u32 {
    let seen = 0;
    for (let i = 0; i < this.intervals.length; i++) {
      if (!this.intervals[i].active) continue;
      if (seen == index) return this.intervals[i].period;
      seen++;
    }
    return 0;
  }

  activeGpioListenerCount(): i32 {
    let count = 0;
    for (let i = 0; i < this.gpioListeners.length; i++) {
      if (this.gpioListeners[i].active) count++;
    }
    return count;
  }

  tickThenObserve(): void {
    this.tick();
    this.clearPins();
    this.tick();
  }
}
