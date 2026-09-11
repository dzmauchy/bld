import { Block, Vector, Widths } from "./basic";
import { CloseHandler, ExecutionContext, GpioInHandler } from "./context";
import { F32PushStream } from "./types";

/**
 * `gpio_in` — source that fans each configured pin out to a vector of
 * `pss<f32>` streams. Incoming true/false becomes 1.0 / 0.0.
 */
export class GpioIn extends Block implements GpioInHandler, CloseHandler {
  pinNumbers: Uint8Array;
  streams: Vector<Vector<F32PushStream>> = new Array<Array<F32PushStream>>();

  constructor(
    blockId: u32,
    widths: Widths,
    ec: ExecutionContext,
    pinNumbers: Uint8Array
  ) {
    super(blockId, widths, ec);
    this.pinNumbers = pinNumbers;
  }

  apply(streams: Vector<Vector<F32PushStream>>): void {
    this.streams = streams;
    this.ec.listenGpioIn(this.blockId, this);
    this.ec.onClose(this);
  }

  onGpioIn(pinIndex: u8, value: bool): void {
    if (i32(pinIndex) >= this.streams.length) return;
    const v: f32 = value ? 1.0 : 0.0;
    const pinStreams = this.streams[i32(pinIndex)];
    for (let i = 0; i < pinStreams.length; i++) {
      pinStreams[i].push(v);
    }
  }

  onClose(): void {
    this.ec.unlistenGpioIn(this.blockId);
  }
}
