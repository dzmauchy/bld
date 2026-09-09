import {ExecutionContext} from "./context";

/**
 * @icon basic.svg
 * @title Basic types
 * @description Basic types for use in the bld namespace
 */
export namespace basic {

  /**
   * @title Boolean value
   * @icon bool.svg
   * @description Boolean type
   */
  export type bool = boolean;

  /**
   * @title Unsigned 8-bit integer
   * @icon u8.svg
   * @description 8-bit unsigned integer (0 to 255)
   */
  export type u8 = Uint8Array[1];

  /**
   * @title Signed 32-bit integer
   * @icon i32.svg
   * @description 32-bit signed two's complement integer
   */
  export type i32 = Int32Array[1];

  /**
   * @title Unsigned 32-bit integer
   * @icon u32.svg
   * @description 32-bit unsigned integer
   */
  export type u32 = Uint32Array[1];

  /**
   * @title Signed 64-bit integer
   * @icon i64.svg
   * @description 64-bit signed integer
   */
  export type i64 = BigInt64Array[1];

  /**
   * @title Unsigned 64-bit integer
   * @icon u64.svg
   * @description 64-bit unsigned integer
   */
  export type u64 = BigUint64Array[1];

  /**
   * @title 32-bit float
   * @icon f32.svg
   * @description Single-precision 32-bit IEEE 754 floating-point number
   */
  export type f32 = Float32Array[1];

  /**
   * @title 64-bit float
   * @icon f64.svg
   * @description Double-precision 64-bit IEEE 754 floating-point number
   */
  export type f64 = number;

  /**
   * @title String text
   * @icon str.svg
   * @description UTF-8 text string
   */
  export type str = string;
}

/**
 * @description Array of output widths
 */
export type Widths = Uint8Array;

/**
 * Represents a vectorized output type
 */
export type Vector<T> = T[];

/**
 * Base class for all blocks
 */
export abstract class Block {

  readonly blockId: basic.u32;
  readonly outputWidths: Widths;
  readonly ec: ExecutionContext;

  protected constructor(blockId: basic.u32, outputWidths: Widths, ec: ExecutionContext) {
    this.blockId = blockId;
    this.outputWidths = outputWidths;
    this.ec = ec;
  }
}
