/**
 * Circular sliding buffer used by browser scopes.
 * One write pointer walks a Float32Array (or Float64Array) ring.
 */
export abstract class SlidingBuffer<TArray extends Float32Array | Float64Array> {
  protected write = 0;
  protected filled = 0;

  constructor(readonly data: TArray) {}

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

  snapshot(): TArray {
    if (this.filled < this.data.length) return this.data.slice(0, this.filled) as TArray;
    const oldest = this.write;
    const first = this.data.subarray(oldest);
    const second = this.data.subarray(0, oldest);
    const copy = new (this.data.constructor as { new (length: number): TArray })(this.data.length);
    copy.set(first, 0);
    copy.set(second, first.length);
    return copy;
  }

  at(index: number): number {
    if (this.filled === 0) return Number.NaN;
    const start = this.filled < this.data.length ? 0 : this.write;
    return this.data[(start + index) % this.data.length] ?? Number.NaN;
  }

  last(): number {
    if (this.filled === 0) return Number.NaN;
    const index = (this.write - 1 + this.data.length) % this.data.length;
    return this.data[index] ?? Number.NaN;
  }

  clear(): void {
    this.write = 0;
    this.filled = 0;
    this.data.fill(0);
  }
}

export class SlidingScopeBuffer extends SlidingBuffer<Float32Array> {
  constructor(capacity: number) {
    super(new Float32Array(Math.max(0, capacity)));
  }

  static fromPeriod(periodSeconds: number, precisionMs: number): SlidingScopeBuffer {
    const samples = Math.max(1, Math.floor((periodSeconds * 1000) / Math.max(1, precisionMs)));
    return new SlidingScopeBuffer(samples);
  }
}

export class SlidingScopeBufferF64 extends SlidingBuffer<Float64Array> {
  constructor(capacity: number) {
    super(new Float64Array(Math.max(0, capacity)));
  }
}
