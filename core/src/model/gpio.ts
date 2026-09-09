import {basic, Block, Vector, Widths} from "./basic";
import {ExecutionContext} from "./context";
import {Message} from "./messages";
import {push} from "./push";
import u32 = basic.u32;
import u8 = basic.u8;
import f64 = basic.f64;
import f64_push_stream = push.f64_push_stream;

/**
 * @icon gpio.svg
 * @title GPIO
 * @description GPIO operations
 */
export namespace gpio {

  /**
   * @icon push_streams.svg
   * @title Push GPIO
   * @description GPIO push operations
   */
  export namespace push {

    /**
     * Represents a block that handles GPIO (General Purpose Input/Output) input pins and dispatches received data to push streams.
     * @icon gpio_in.svg
     * @title GPIO In
     * @ui The UI should create the inputs depending on the {@link pinNumbers} control. The control should be able to add and remove the pins
     *     and validate the pins (0..255) and their count (>= 1 and <= 256). The default UI control should have one pin 0,
     *     after adding a new pin with a + button, the UI should create a new pin with the number of the last pin + 1. The pins
     *     should be sorted in ascending order.
     */
    export class GpioInF64 extends Block {

      /**
       * @icon pin_numbers.svg
       * @title Pin Numbers
       * @inputType pin_numbers
       */
      readonly pinNumbers: Uint8Array;

      constructor(blockId: u32, widths: Widths, ec: ExecutionContext, pinNumbers: Uint8Array = new Uint8Array([0])) {
        super(blockId, widths, ec);
        this.pinNumbers = pinNumbers;
      }

      /**
       * Applies the given push streams to handle GPIO input messages.
       * Listens for incoming "message" events and dispatches the GPIO input values to the corresponding streams.
       *
       * @param streams A vector of vectorized push streams corresponding to {@link pinNumbers}.
       * Each stream corresponds to a specific pin and accepts a floating-point value (0 or 1).
       * @return void This is a push generator. Push generators don't return values
       */
      public apply(streams: Vector<Vector<f64_push_stream>>): void {
        const listener = (event: MessageEvent<Message>) => {
          const data = event.data;
          if (data && data.kind === "gpio_in" && data.blockId === this.blockId) {
            const pin: u8 = data.pinIndex;
            const value: f64 = data.value ? 1 : 0;
            for (const s of streams[pin]) {
              s(value);
            }
          }
        };
        self.addEventListener("message", listener);
        this.ec.onClose(() => self.removeEventListener("message", listener));
      }
    }
  }
}