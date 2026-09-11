import type { LibraryApi } from "runtime";

/**
 * Base library block implementations, written against the runtime TS DSL.
 * Bundled to `dist/assembly.js` for the runtime to load.
 */
export function install(api: LibraryApi): void {
  api.define("scope_f32", (block) => {
    block.values("nan");
    block.onPush((push) => push.storeChannel());
    block.onTick(block.precision(10), (tick) => tick.flushArrayToPins());
  });

  api.define("product_f32", (block) => {
    block.values("one");
    block.onPush((push) => {
      push.storeAndRecord();
      push.forward(push.product());
    });
  });

  api.define("sum_f32", (block) => {
    block.values("zero");
    block.onPush((push) => {
      push.storeAndRecord();
      push.forward(push.sum());
    });
  });

  api.defineUnary("cos_f32", (push, val) => push.cos(val));
  api.defineUnary("sin_f32", (push, val) => push.sin(val));

  api.defineGenerator("const_f32", (_tick, block) => _tick.f32(block.confNum("v", 0)));
  api.defineGenerator("cos_gen_f32", (tick) => tick.cos(tick.nowSeconds()));
  api.defineGenerator("sin_gen_f32", (tick) => tick.sin(tick.nowSeconds()));
  api.defineGenerator("rand_gen_f32", (tick) => tick.random());

  api.definePeriodic("pulse_gen_f32", (block) => {
    const period = Math.max(0, block.confNum("period", 10));
    const duty = block.confNum("duty_cycle", 0.5);
    block.onTick(1, (tick) => tick.forward(tick.pulse(period, duty)));
  });

  api.define("gpio_in", (block) => {
    block.onGpio((gpio) => gpio.forwardPins());
  });
}
