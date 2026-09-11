import { GpioIn } from "../gpio";
import { ConstF32, ProductF32, ScopeF32 } from "../push";
import {
  TestExecutionContext,
  dest1,
  dest2,
  expectNoPin,
  expectPin,
  gpioSinks,
  gpioSinks3,
  pins,
  tickThenObserve,
  widths,
} from "./harness";

export function test_gpio_in_true_is_one_on_scope(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const gpioIn = new GpioIn(1, widths(1), ec, pins(0));
  gpioIn.apply(gpioSinks(sinks));
  ec.emitGpioIn(1, 0, true);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
}

export function test_gpio_in_false_is_zero_on_scope(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const gpioIn = new GpioIn(1, widths(1), ec, pins(0));
  gpioIn.apply(gpioSinks(sinks));
  ec.emitGpioIn(1, 0, false);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
}

export function test_gpio_in_routes_pins_independently(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(3), ec);
  const sinks = scope.apply();
  const gpioIn = new GpioIn(1, widths(1), ec, pins(0, 1, 4));
  gpioIn.apply(gpioSinks3(dest1(sinks[0]), dest1(sinks[1]), dest1(sinks[2])));
  ec.emitGpioIn(1, 0, true);
  ec.emitGpioIn(1, 1, false);
  ec.emitGpioIn(1, 2, true);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  expectPin(ec, 0, 1, 0.0);
  expectPin(ec, 0, 2, 1.0);
}

export function test_gpio_in_fans_out_to_product_and_scope(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(2), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(2), ec);
  const factors = product.apply(dest1(sinks[0]));
  new ConstF32(2, widths(1), ec, 10, 5.0).apply(dest1(factors[0]));
  const gpioIn = new GpioIn(3, widths(1), ec, pins(0));
  gpioIn.apply(gpioSinks(dest2(factors[1], sinks[1])));
  ec.emitGpioIn(3, 0, true);
  ec.tick();
  expectPin(ec, 1, 0, 5.0);
  expectPin(ec, 1, 1, 1.0);
  ec.clearPins();
  ec.tick();
  expectPin(ec, 0, 0, 5.0);
  expectPin(ec, 0, 1, 1.0);
}

export function test_gpio_in_ignores_other_block_ids(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const gpioIn = new GpioIn(1, widths(1), ec, pins(0));
  gpioIn.apply(gpioSinks(sinks));
  ec.emitGpioIn(99, 0, true);
  ec.tick();
  expectPin(ec, 0, 0, f32.NaN);
}

export function test_gpio_in_on_close_stops_listening(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const gpioIn = new GpioIn(1, widths(1), ec, pins(0));
  gpioIn.apply(gpioSinks(sinks));
  ec.close();
  assert(ec.activeGpioListenerCount() == 0);
  ec.emitGpioIn(1, 0, true);
  ec.clearPins();
  ec.tick();
  expectNoPin(ec, 0, 0);
}

export function test_gpio_in_stores_configured_pins(): void {
  const ec = new TestExecutionContext();
  const gpioIn = new GpioIn(1, widths(1), ec, pins(0, 1, 4));
  assert(gpioIn.pinNumbers.length == 3);
  assert(gpioIn.pinNumbers[0] == 0);
  assert(gpioIn.pinNumbers[1] == 1);
  assert(gpioIn.pinNumbers[2] == 4);
}
