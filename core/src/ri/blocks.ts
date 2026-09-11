import {Block, ExecutionContext, f32, pss, u16, u32, u8, VectorizedInput, VectorizedOutput} from "./context";

export namespace push {
  export namespace f32 {
    export namespace transformers {
      export class cos_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32) {}
        public apply(v: VectorizedInput<pss<f32>>): [cos: pss<f32>] {
          return [value => {
            const transformed = this.ctx.cos32(value);
            for (const inp of v) inp(transformed);
          }];
        }
      }
      export class sin_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32) {}
        public apply(v: VectorizedInput<pss<f32>>): [sin: pss<f32>] {
          return [value => {
            const transformed = this.ctx.sin32(value);
            for (const inp of v) inp(transformed);
          }];
        }
      }
      export class product_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32,
                    readonly precision: u32 = 10) {}
        public apply(v: VectorizedInput<pss<f32>>): [p: VectorizedOutput<pss<f32>>] {
          return [n => {
            const result = new Array<pss<f32>>(n);
            const values = new Float32Array(n);
            values.fill(Number.NaN);
            this.ctx.onStart(() => {
              const hTimer = this.ctx.setInterval(this.precision, () => {
                let product = Number.NaN;
                for (const pv of values) {
                  if (Number.isFinite(pv)) {
                    if (Number.isFinite(product)) product *= pv;
                    else product = pv;
                  } else {
                    product = Number.NaN;
                    break;
                  }
                }
                if (Number.isFinite(product)) {
                  for (const inp of v) inp(product);
                }
              });
              this.ctx.onClose(() => this.ctx.clearInterval(hTimer));
            });
            for (let i = 0; i < n; i++) result[i] = value => values[i] = value;
            return result;
          }];
        }
      }
      export class sum_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32,
                    readonly precision: u32 = 10) {}
        public apply(v: VectorizedInput<pss<f32>>): [s: VectorizedOutput<pss<f32>>] {
          return [n => {
            const result = new Array<pss<f32>>(n);
            const values = new Float32Array(n);
            values.fill(Number.NaN);
            this.ctx.onStart(() => {
              const hTimer = this.ctx.setInterval(this.precision, () => {
                let sum = Number.NaN;
                for (const pv of values) {
                  if (Number.isFinite(pv)) {
                    if (Number.isFinite(sum)) sum += pv;
                    else sum = pv;
                  } else {
                    sum = Number.NaN;
                    break;
                  }
                }
                if (Number.isFinite(sum)) {
                  for (const inp of v) inp(sum);
                }
              });
              this.ctx.onClose(() => this.ctx.clearInterval(hTimer));
            });
            for (let i = 0; i < n; i++) result[i] = value => values[i] = value;
            return result;
          }];
        }
      }
    }
    export namespace sinks {
      export class scope_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32,
                    readonly period: u32 = 60, readonly precision: u32 = 10) {}
        public apply(): [sink: VectorizedOutput<pss<f32>>] {
          return [n => {
            const result = new Array<pss<f32>>(n);
            for (let i = 0; i < n; i++) result[i] = value => {
              this.ctx.sendF32(this.id, i, value);
            };
            return result;
          }];
        }
      }
    }
    export namespace sources {
      export class gpio_in_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32,
                    readonly port: u16 = 0,
                    readonly pins: Uint8Array = new Uint8Array([0])) {}
        private searchPin(pin: u8): number {
          let l = 0;
          let r = this.pins.length - 1;
          while (l <= r) {
            const m = (l + r) >>> 1;
            const v = this.pins[m];
            if (v < pin) l = m + 1;
            else if (v > pin) r = m - 1;
            else return m;
          }
          return -1;
        }
        public apply(pin: VectorizedInput<pss<f32>>[]): void {
          this.ctx.onStart(() => {
            const hGPIO = this.ctx.setGPIO(this.port, (p, v) => {
              const idx = this.searchPin(p);
              if (idx >= 0) {
                const val = v ? 1 : 0;
                for (const ps of pin[idx]) ps(val);
              }
            });
            this.ctx.onClose(() => this.ctx.clearGPIO(hGPIO));
          });
        }
      }
      export class const_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32,
                    readonly v: f32 = 1) {}
        public apply(v: VectorizedInput<pss<f32>>): void {
          this.ctx.onStart(() => {
            for (const inp of v) inp(this.v);
          });
        }
      }
      export class cos_gen_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32,
                    readonly precision: u32 = 10, readonly frequency: f32 = 1,
                    readonly amplitude: f32 = 1, readonly phase: f32 = 0) {}
        public apply(v: VectorizedInput<pss<f32>>): void {
          this.ctx.onStart(() => {
            const t0 = this.ctx.now();
            const twoPi = 2 * 3.1415926;
            const hTimer = this.ctx.setInterval(this.precision, () => {
              const now = this.ctx.now();
              const elapsedSec = Number((now - t0)) * 0.001;
              let angle = (elapsedSec * this.frequency * twoPi + this.phase) % twoPi;
              if (angle < 0) angle += twoPi;
              const val = this.amplitude * this.ctx.cos32(angle);
              for (const inp of v) inp(val);
            });
            this.ctx.onClose(() => this.ctx.clearInterval(hTimer));
          });
        }
      }
      export class sin_gen_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32,
                    readonly precision: u32 = 10, readonly frequency: f32 = 1,
                    readonly amplitude: f32 = 1, readonly phase: f32 = 0) {}
        public apply(v: VectorizedInput<pss<f32>>): void {
          this.ctx.onStart(() => {
            const t0 = this.ctx.now();
            const twoPi = 2 * 3.1415926;
            const hTimer = this.ctx.setInterval(this.precision, () => {
              const now = this.ctx.now();
              const elapsedSec = Number((now - t0)) * 0.001;
              let angle = (elapsedSec * this.frequency * twoPi + this.phase) % twoPi;
              if (angle < 0) angle += twoPi;
              const val = this.amplitude * this.ctx.sin32(angle);
              for (const inp of v) inp(val);
            });
            this.ctx.onClose(() => this.ctx.clearInterval(hTimer));
          });
        }
      }
      export class rand_gen_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32,
                    readonly precision: u32 = 10, readonly amplitude: f32 = 1) {}
        public apply(v: VectorizedInput<pss<f32>>): void {
          this.ctx.onStart(() => {
            const hTimer = this.ctx.setInterval(this.precision, () => {
              for (const inp of v) inp(this.ctx.random32() * this.amplitude);
            });
            this.ctx.onClose(() => this.ctx.clearInterval(hTimer));
          });
        }
      }
      export class pulse_gen_f32 implements Block {
        constructor(readonly ctx: ExecutionContext, readonly id: u32,
                    readonly duty_cycle: f32 = 0.5,
                    readonly amplitude: f32 = 1,
                    readonly frequency: f32 = 1,
                    readonly phase: f32 = 0) {}
        public apply(v: VectorizedInput<pss<f32>>): void {
          this.ctx.onStart(() => {
            const t0 = this.ctx.now();
            const twoPi = 2 * 3.1415926;
            const hTimer = this.ctx.setInterval(1, () => {
              const now = this.ctx.now();
              const elapsedSec = Number(now - t0) * 0.001;
              let angle = (elapsedSec * this.frequency * twoPi + this.phase) % twoPi;
              if (angle < 0) angle += twoPi;

              const progress = angle / twoPi;
              const val = progress < this.duty_cycle ? this.amplitude : 0;
              for (const inp of v) inp(val);
            });
            this.ctx.onClose(() => this.ctx.clearInterval(hTimer));
          });
        }
      }
    }
  }
}