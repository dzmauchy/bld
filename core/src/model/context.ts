import {basic} from "./basic";
import u32 = basic.u32;
import u8 = basic.u8;
import bool = basic.bool;
import f64 = basic.f64;

/**
 * The ExecutionContext interface provides various methods for managing intervals,
 * handling execution lifecycles, interfacing with hardware outputs, and performing
 * mathematical operations.
 */
export interface ExecutionContext {

  /**
   * Schedules a repeated execution of the specified callback function with a fixed time delay between successive executions.
   *
   * @param {u32} period - The time delay, in milliseconds, between successive executions of the callback function.
   * @param {() => void} callback - The function to be executed periodically at the specified interval.
   * @return {u32} A unique identifier for the interval, which can be used to clear the interval later if necessary.
   */
  setInterval(period: u32, callback: () => void): u32;

  /**
   * Cancels a timed, repeating action, which was previously established by a call to `setInterval`.
   *
   * @param {u32} id - The identifier of the interval to clear. This ID is returned by the `setInterval` function when the interval is created.
   * @return {void} This method does not return any value.
   */
  clearInterval(id: u32): void;

  /**
   * Registers a callback function to be executed when a close event occurs.
   *
   * @param {Function} callback - The function to be executed on close. This should be a parameterless function.
   * @return {void} No value is returned.
   */
  registerOnCloseCallback(callback: () => void): void;

  /**
   * Sends a pin signal to the specified output block with given parameters.
   *
   * @param {u32} blockId - The identifier for the output block to which the pin signal is sent.
   * @param {u8} pin - The output pin being activated or controlled.
   * @param {bool} reverse - Indicates whether the signal is reversed (true for reverse, false otherwise).
   * @param {f64} v - The value associated with the pin signal, typically representing intensity or magnitude.
   * @return {void} This method does not return a value.
   */
  sendPin64(blockId: u32, pin: u8, reverse: bool, v: f64): void;

  /**
   * Calculates the cosine of the given angle in radians.
   *
   * @param {f64} v - The angle in radians for which the cosine is to be computed.
   * @return {f64} The cosine of the given angle.
   */
  cos(v: f64): f64;

  /**
   * Computes the sine of the given angle in radians.
   *
   * @param {f64} v - The angle in radians for which to compute the sine.
   * @return {f64} The sine of the given angle.
   */
  sin(v: f64): f64;

  /**
   * Calculates the tangent of a number.
   *
   * @param v The input value in radians for which to calculate the tangent.
   * @return The tangent of the input value.
   */
  tan(v: f64): f64;

  /**
   * Generates a random floating-point number in the range [0.0, 1.0).
   *
   * @return {f64} A random number between 0.0 (inclusive) and 1.0 (exclusive).
   */
  random(): f64;
}