import type { LibraryApi } from "runtime";

/**
 * Base library block implementations, written against the runtime TS DSL.
 * Bundled to `dist/assembly.js` for the runtime to load.
 */
export function install(api: LibraryApi): void {
  api.define("scope_f32", {
    push: true,
    tick: true,
    priority: 0,
    emit(block) {
      block.values("nan");
      block.onPush((push) => {
        push.store(push.channel, push.value);
      });
            block.onTick(block.confNum("precision", 10), (tick) => {
              tick.forRange(tick.arrayLen(), (index) => {
                tick.recordPin(index(), tick.arrayGet(index()));
              });
            });
    },
  });

  api.define("product_f32", {
    push: true,
    priority: 1,
    channels: "product",
    emit(block) {
      block.values("one");
      block.onPush((push) => {
        push.store(push.channel, push.value);
        push.recordPin(push.channel, push.value);
        push.forward(push.product());
      });
    },
  });

  api.define("cos_f32", {
    push: true,
    priority: 1,
    emit(block) {
      block.onPush((push) => {
        const out = push.letF32(push.cos(push.value));
        push.recordPin(push.i32(0), out());
        push.forward(out());
      });
    },
  });

  api.define("sin_f32", {
    push: true,
    priority: 1,
    emit(block) {
      block.onPush((push) => {
        const out = push.letF32(push.sin(push.value));
        push.recordPin(push.i32(0), out());
        push.forward(out());
      });
    },
  });

  api.define("const_f32", {
    tick: true,
    emit(block) {
      block.onTick(block.confNum("precision", 10), (tick) => {
        tick.forward(tick.f32(block.confNum("v", 0)));
      });
    },
  });

  api.define("cos_gen_f32", {
    tick: true,
    emit(block) {
      block.onTick(block.confNum("precision", 10), (tick) => {
        tick.forward(tick.cos(tick.nowSeconds()));
      });
    },
  });

  api.define("sin_gen_f32", {
    tick: true,
    emit(block) {
      block.onTick(block.confNum("precision", 10), (tick) => {
        tick.forward(tick.sin(tick.nowSeconds()));
      });
    },
  });

  api.define("rand_gen_f32", {
    tick: true,
    emit(block) {
      block.onTick(block.confNum("precision", 10), (tick) => {
        tick.forward(tick.random());
      });
    },
  });

  api.define("pulse_gen_f32", {
    tick: true,
    emit(block) {
      const period = Math.max(0, block.confNum("period", 10));
      const duty = block.confNum("duty_cycle", 0.5);
      block.onTick(1, (tick) => {
        const high =
          period === 0
            ? tick.f32(0)
            : tick.select(
                tick.i64LtU(
                  tick.i64RemU(tick.nowI64(), tick.i64ExtendU32(tick.i32(period))),
                  tick.i64TruncUSatF32(tick.f32(period * duty)),
                ),
                tick.f32(1),
                tick.f32(0),
              );
        tick.forward(high);
      });
    },
  });

  api.define("gpio_in", {
    emit(block) {
      block.onGpio((gpio) => {
        gpio.eachPin((_pinIndex, consumers) => {
          gpio.forward(gpio.highIfTrue(), consumers);
        });
      });
    },
  });
}
