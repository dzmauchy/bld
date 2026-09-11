import { ExecutionContext } from "./context";

/** Port width, one entry per apply() port. */
export type Widths = Uint8Array;

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
