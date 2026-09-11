import { ExecutionContext } from "./context";

/** Vectorized port width, one entry per vectorized apply() port. */
export type Widths = Uint8Array;

/** Vectorized collection of values or push streams. */
export type Vector<T> = Array<T>;

/** Base class for every block in `blocks.json`. */
export class Block {
  blockId: u32;
  outputWidths: Widths;
  ec: ExecutionContext;

  constructor(blockId: u32, outputWidths: Widths, ec: ExecutionContext) {
    this.blockId = blockId;
    this.outputWidths = outputWidths;
    this.ec = ec;
  }
}
