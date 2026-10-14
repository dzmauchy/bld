/**
 * Circular sliding buffer used by browser scopes.
 * One write pointer walks a Float32Array (or Float64Array) ring.
 */
export abstract class SlidingBuffer<TArray extends Float32Array | Float64Array> {
  protected write = 0;
  protected filled = 0;

  protected constructor(readonly data: TArray) {
    this.data.fill(Number.NaN);
  }

  static fromPeriod<TBuffer extends SlidingBuffer<Float32Array | Float64Array>>(
    this: new (capacity: number) => TBuffer,
    periodSeconds: number,
    precisionMs: number,
  ): TBuffer {
    return new this(SlidingBuffer.capacityFor(periodSeconds, precisionMs));
  }

  static capacityFor(periodSeconds: number, precisionMs: number): number {
    return Math.max(1, Math.floor((periodSeconds * 1000) / Math.max(1, precisionMs)));
  }

  get capacity(): number {
    return this.data.length;
  }

  get pointer(): number {
    return this.write;
  }

  get size(): number {
    return this.filled;
  }

  push(value: number): void {
    if (this.data.length === 0) return;
    this.data[this.write] = value;
    this.write = (this.write + 1) % this.data.length;
    if (this.filled < this.data.length) this.filled += 1;
  }

  /** Reads the fixed window from oldest to newest, including unfilled NaN slots. */
  at(index: number): number {
    if (index < 0 || index >= this.data.length) return Number.NaN;
    return this.data[(this.write + index) % this.data.length] ?? Number.NaN;
  }

  last(): number {
    if (this.filled === 0) return Number.NaN;
    const index = (this.write - 1 + this.data.length) % this.data.length;
    return this.data[index] ?? Number.NaN;
  }

  clear(): void {
    this.write = 0;
    this.filled = 0;
    this.data.fill(Number.NaN);
  }
}

export class SlidingScopeBuffer extends SlidingBuffer<Float32Array> {
  constructor(capacity: number) {
    super(new Float32Array(Math.max(0, capacity)));
  }
}

export class SlidingScopeBufferF64 extends SlidingBuffer<Float64Array> {
  constructor(capacity: number) {
    super(new Float64Array(Math.max(0, capacity)));
  }
}
