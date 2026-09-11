/**
 * Types corresponding to `core/assets/types.json`.
 *
 * Primitive keys in that catalog (`bool`, `i8`, `u8`, `i16`, `u16`, `i32`,
 * `u32`, `i64`, `u64`, `f32`, `f64`) are AssemblyScript builtins and are used
 * directly throughout this package.
 *
 * `pss` is a push stream: an object with a `push` method.
 * `array` is a managed `Array<T>`.
 */

/** Push stream (`pss` in types.json). */
export interface Pss<T> {
  push(value: T): void;
}
