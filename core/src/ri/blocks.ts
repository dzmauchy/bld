import { Block, ExecutionContext, f32, pss, u16, u32, u8, VectorizedInput, VectorizedOutput } from "./context";

export const TWO_PI = 2 * 3.1415926;

export abstract class UnaryTransformerBlock implements Block {
  constructor(readonly ctx: ExecutionContext, readonly id: u32) {}
  protected abstract transform(value: f32): f32;
  public apply(v: VectorizedInput<pss<f32>>): [output: pss<f32>] {
    return [value => { const t = this.transform(value); for (const inp of v) inp(t); }];
  }
}

export abstract class PeriodicReducerBlock implements Block {
  constructor(readonly ctx: ExecutionContext, readonly id: u32, readonly precision: u32 = 10) {}
  protected abstract accumulate(current: f32, next: f32): f32;
  public apply(v: VectorizedInput<pss<f32>>): [output: VectorizedOutput<pss<f32>>] {
    return [n => {
      const values = new Float32Array(n).fill(Number.NaN);
      this.ctx.onStart(() => {
        const h = this.ctx.setInterval(this.precision, () => {
          let acc = Number.NaN;
          for (const pv of values) {
            if (!Number.isFinite(pv)) { acc = Number.NaN; break; }
            acc = Number.isFinite(acc) ? this.accumulate(acc, pv) : pv;
          }
          if (Number.isFinite(acc)) for (const inp of v) inp(acc);
        });
        this.ctx.onClose(() => this.ctx.clearInterval(h));
      });
      return Array.from({ length: n }, (_, i) => value => { values[i] = value; });
    }];
  }
}

export abstract class PeriodicGeneratorBlock implements Block {
  constructor(readonly ctx: ExecutionContext, readonly id: u32, readonly precision: u32 = 10) {}
  protected abstract computeSample(elapsedSec: number): f32;
  public apply(v: VectorizedInput<pss<f32>>): void {
    this.ctx.onStart(() => {
      const t0 = this.ctx.now();
      const h = this.ctx.setInterval(this.precision, () => {
        const val = this.computeSample(Number(this.ctx.now() - t0) * 0.001);
        for (const inp of v) inp(val);
      });
      this.ctx.onClose(() => this.ctx.clearInterval(h));
    });
  }
}

export abstract class HarmonicWaveGenerator extends PeriodicGeneratorBlock {
  constructor(
    ctx: ExecutionContext, id: u32, precision: u32 = 10,
    readonly frequency: f32 = 1, readonly amplitude: f32 = 1, readonly phase: f32 = 0,
  ) { super(ctx, id, precision); }
  protected normalizeAngle(sec: number): number {
    let a = (sec * this.frequency * TWO_PI + this.phase) % TWO_PI;
    return a < 0 ? a + TWO_PI : a;
  }
}

export namespace push {
  export namespace f32 {
    export namespace transformers {
      export class cos_f32 extends UnaryTransformerBlock {
        protected override transform(v: f32) { return this.ctx.cos32(v); }
      }
      export class sin_f32 extends UnaryTransformerBlock {
        protected override transform(v: f32) { return this.ctx.sin32(v); }
      }
      export class product_f32 extends PeriodicReducerBlock {
        protected override accumulate(a: f32, b: f32) { return a * b; }
      }
      export class sum_f32 extends PeriodicReducerBlock {
        protected override accumulate(a: f32, b: f32) { return a + b; }
      }
    }

    export namespace sinks {
      export class scope_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32, readonly period: u32 = 60, readonly precision: u32 = 10) {}
        public apply(): [sink: VectorizedOutput<pss<f32>>] {
          return [n => Array.from({ length: n }, (_, i) => value => { this.ctx.sendF32(this.id, i, value); })];
        }
      }
    }

    export namespace sources {
      export class gpio_in_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32, readonly port: u16 = 0, readonly pins: Uint8Array = new Uint8Array([0])) {}
        private searchPin(pin: u8): number {
          let l = 0, r = this.pins.length - 1;
          while (l <= r) {
            const m = (l + r) >>> 1, v = this.pins[m];
            if (v < pin) l = m + 1; else if (v > pin) r = m - 1; else return m;
          }
          return -1;
        }
        public apply(pin: VectorizedInput<pss<f32>>[]): void {
          this.ctx.onStart(() => {
            const h = this.ctx.setGPIO(this.port, (p, v) => {
              const idx = this.searchPin(p);
              if (idx >= 0) for (const ps of pin[idx]) ps(v ? 1 : 0);
            });
            this.ctx.onClose(() => this.ctx.clearGPIO(h));
          });
        }
      }
      export class const_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32, readonly v: f32 = 1) {}
        public apply(v: VectorizedInput<pss<f32>>): void {
          this.ctx.onStart(() => { for (const inp of v) inp(this.v); });
        }
      }
      export class cos_gen_f32 extends HarmonicWaveGenerator {
        protected override computeSample(sec: number) { return this.amplitude * this.ctx.cos32(this.normalizeAngle(sec)); }
      }
      export class sin_gen_f32 extends HarmonicWaveGenerator {
        protected override computeSample(sec: number) { return this.amplitude * this.ctx.sin32(this.normalizeAngle(sec)); }
      }
      export class rand_gen_f32 extends PeriodicGeneratorBlock {
        constructor(ctx: ExecutionContext, id: u32, precision: u32 = 10, readonly amplitude: f32 = 1) {
          super(ctx, id, precision);
        }
        protected override computeSample() { return this.ctx.random32() * this.amplitude; }
      }
      export class pulse_gen_f32 extends HarmonicWaveGenerator {
        constructor(ctx: ExecutionContext, id: u32, readonly duty_cycle: f32 = 0.5, amplitude: f32 = 1, frequency: f32 = 1, phase: f32 = 0) {
          super(ctx, id, 1, frequency, amplitude, phase);
        }
        protected override computeSample(sec: number) {
          return (this.normalizeAngle(sec) / TWO_PI) < this.duty_cycle ? this.amplitude : 0;
        }
      }
    }
  }
}