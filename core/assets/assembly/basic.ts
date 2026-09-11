import { ExecutionContext } from "./context";

/** Base class for every block in `blocks.json`. */
export class Block {
  blockId: u32;
  /** Port width, one entry per apply() port. */
  outputWidths: Uint8Array;
  ec: ExecutionContext;

  constructor(blockId: u32, outputWidths: Uint8Array, ec: ExecutionContext) {
    this.blockId = blockId;
    this.outputWidths = outputWidths;
    this.ec = ec;
  }
}
