import {basic} from "./basic";
import u8 = basic.u8;
import u32 = basic.u32;

export interface GpioInMessage {
  kind: "gpio_in";
  blockId: u32
  pinIndex: u8;
  value: boolean;
}

export type Message = GpioInMessage;