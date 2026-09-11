export type u8 = Uint8Array[0];
export type u16 = Uint16Array[0];
export type u32 = Uint32Array[0];
export type u64 = BigUint64Array[0];
export type f32 = Float32Array[0];
export type f64 = Float64Array[0];

export type pss<T> = (v: T) => void;
export type VectorizedOutput<T> = (size: u8) => T[];
export type VectorizedInput<T> = T[];

export interface ExecutionContext {
  onStart(callback: () => void): void;
  onClose(callback: () => void): void;
  setGPIO(port: u16, callback: (pin: u8, v: boolean) => void): u32;
  setInterval(period: u32, callback: () => void): u32;
  clearGPIO(id: u32): void;
  clearInterval(id: u32): void;
  sendF32(blockId: u32, pin: u8, v: f32): void;
  sendF64(blockId: u32, pin: u8, v: f64): void;
  sin32(v: f32): f32;
  cos32(v: f32): f32;
  sin64(v: f64): f64;
  cos64(v: f64): f64;
  sqrt32(v: f32): f32;
  sqrt64(v: f64): f64;
  pow32(v: f32, exp: f32): f32;
  pow64(v: f64, exp: f64): f64;
  random32(): f32;
  random64(): f64;
  now(): u64;
}

export interface Block {
  readonly ctx: ExecutionContext;
  readonly id: u32;
}