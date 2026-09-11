import {basic, Block, Vector} from "./basic";
import {ExecutionContext} from "./context";
import u32 = basic.u32;
import f32 = basic.f32;
import f64 = basic.f64;

/**
 * @icon push_streams.svg
 * @title Push stream
 * @description Push-based streams for use in the bld namespace
 */
export namespace push {

  /**
   * Represents a function type that acts as a stream for pushing 32-bit floating-point numbers.
   * This stream accepts a single 32-bit floating-point number (f32) as an argument.
   * It is typically used in scenarios where continuous or discrete numeric data needs to be pushed or processed.
   *
   * @icon push_streams_f32.svg
   * @title f32 push stream
   * @param {number} arg - A 32-bit floating-point number (f32) to be pushed to the stream.
   */
  export type f32_push_stream = (arg: f32) => void;

  /**
   * Represents a function type that acts as a stream for pushing 64-bit floating-point numbers.
   * This stream accepts a single 64-bit floating-point number (f64) as an argument.
   * It is typically used in scenarios where continuous or discrete numeric data needs to be pushed or processed.
   *
   * @icon push_streams_f64.svg
   * @title f64 push stream
   * @param {number} arg - A 64-bit floating-point number (f64) to push into the stream.
   */
  export type f64_push_stream = (arg: f64) => void;

  /**
   * Represents a Scope block for floating-point data of 64-bit precision.
   * This class is designed to operate within an execution context, providing a mechanism
   * to output streams of 64-bit floating-point numbers based on a specified time window
   * and precision.
   *
   */
  export class ScopeF64 extends Block {

    /**
     * @icon time_window.svg
     * @title Window (s)
     * @inputType slider
     * @min 10
     * @max 600
     * @step 10
     */
    readonly window: u32;

    /**
     * @icon precision.svg
     * @title Precision (ms)
     * @inputType slider
     * @min 10
     * @max 1000
     * @step 10
     */
    readonly precision: u32;

    /**
     * @param blockId Block ID
     * @param widths Output widths
     * @param ec Execution context
     * @param window Time window (s)
     * @param precision Precision (ms)
     */
    constructor(blockId: u32, widths: Uint8Array, ec: ExecutionContext, window: u32 = 60, precision: u32 = 10) {
      super(blockId, widths, ec);
      this.window = window;
      this.precision = precision;
    }

    public apply(): [streams: Vector<f64_push_stream>] {
      const outputCount = Number(this.outputWidths[0]);
      const streams: f64_push_stream[] = new Array<f64_push_stream>(outputCount);
      const values = new Array<f64>(outputCount);
      values.fill(Number.NaN);
      const timer = this.ec.setInterval(this.precision, () => {
        for (let i = 0; i < outputCount; i++) {
          this.ec.sendPinF64(this.blockId, i, values[i]);
        }
      });
      this.ec.onClose(() => this.ec.clearInterval(timer));
      for (let i = 0; i < outputCount; i++) {
        streams[i] = v => values[i] = v;
      }
      return [streams];
    }
  }

  /**
   * Class representing a ramp signal generator with adjustable precision. The ramp
   * signal produces a continuous stream of timestamps at regular intervals, based
   * on the configured precision.
   */
  export class RampF64 extends Block {

    /**
     * Represents the generator precision
     * @icon precision.svg
     * @title Precision (ms)
     * @inputType slider
     * @min 1
     * @max 1000
     * @step 1
     */
    readonly precision: u32;

    constructor(blockId: u32, widths: Uint8Array, ec: ExecutionContext, precision: u32 = 10) {
      super(blockId, widths, ec);
      this.precision = precision;
    }

    public apply(streams: Vector<f64_push_stream>): void {
      const timerId = this.ec.setInterval(this.precision, () => {
        const time = Number(this.ec.now()) * 1e-3;
        for (const s of streams) {
          s(time);
        }
      });
      this.ec.onClose(() => this.ec.clearInterval(timerId));
    }
  }

  export class ConstantF64 extends Block {

    /**
     * Represents the generator precision
     * @icon precision.svg
     * @title Precision (ms)
     * @inputType slider
     * @min 1
     * @max 1000
     * @step 1
     */
    readonly precision: u32;

    /**
     * Represents the constant value
     * @icon value.svg
     * @title Value
     * @inputType number
     */
    readonly value: f64;

    constructor(blockId: u32, widths: Uint8Array, ec: ExecutionContext, precision: u32 = 10, value: f64 = 1) {
      super(blockId, widths, ec);
      this.precision = precision;
      this.value = value;
    }

    /**
     * Applies a constant value to the input stream
     * @param streams Downstream streams to apply the constant value to
     */
    public apply(streams: Vector<f64_push_stream>): void {
      const v = Number(this.value);
      const timerId = this.ec.setInterval(this.precision, () => {
        for (const s of streams) {
          s(v);
        }
      });
      this.ec.onClose(() => this.ec.clearInterval(timerId));
    }
  }


  /**
   * Represents a cosine function block that applies a cosine transformation to the input stream.
   * @title Cos
   * @icon cos.svg
   */
  export class CosF64 extends Block {
    constructor(blockId: u32, widths: Uint8Array, ec: ExecutionContext) {
      super(blockId, widths, ec);
    }

    public apply(downstream: Vector<f64_push_stream>): [out: f64_push_stream] {
      return [v => {
        const cos = this.ec.cos(v);
        this.ec.sendPinF64(this.blockId, 0, cos);
        for (const s of downstream) s(cos);
      }];
    }
  }

  /**
   * The Product class extends the Block class and is responsible for implementing
   * functionality to handle a product operation on a stream of floating-point numbers.
   * It provides a mechanism to apply the product operation across multiple values
   * in a streaming fashion.
   */
  export class ProductF64 extends Block {

    /**
     * Represents an array of default values for the product block.
     * It should be guaranteed to have the same length as the number of output pins.
     * @icon default_values.svg
     * @title Default Values
     * @inputType array_of_f64
     */
    readonly defaultValues: Float64Array;

    constructor(blockId: u32, widths: Uint8Array, ec: ExecutionContext, defaultValues: Float64Array = new Float64Array([1])) {
      super(blockId, widths, ec);
      this.defaultValues = new Float64Array(defaultValues);
    }

    /**
     * Applies the product operation to a given stream of floating-point numbers.
     * @param streams The input vectorized stream of floating-point numbers.
     * @returns An array of streams with the product operation applied.
     */
    public apply(streams: Vector<f64_push_stream>): [streams: Vector<f64_push_stream>] {
      const outputCount = this.outputWidths[0];
      const values = new Float64Array(this.defaultValues);
      const result = new Array<f64_push_stream>(outputCount);
      for (let i = 0; i < outputCount; i++) {
        result[i] = v => {
          values[i] = v;
          this.ec.sendPinF64(this.blockId, i, v);
          let product = 1;
          for (let j = 0; j < outputCount; j++) product *= values[j];
          for (const s of streams) s(product);
        };
      }
      return [result];
    }
  }
}