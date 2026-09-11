import { GpioIn } from "../gpio";
import { ConstF32, CosF32, CosGenF32, ProductF32, PulseGenF32, RandGenF32, ScopeF32, SinGenF32 } from "../push";
import {
  TestExecutionContext,
  dest1,
  expectPin,
  gpioSinks,
  pins,
  tickThenObserve,
  widths,
} from "./harness";

/** Wiring similar to `diagram_demo.json`: generators, product, gpio, scope. */
export function test_demo_diagram_cos_gen_to_scope(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec, 30, 11);
  const sinks = scope.apply();
  new CosGenF32(1, widths(1), ec, 11).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
}

export function test_demo_diagram_cos_times_sin_at_zero(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec, 30, 11);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(2), ec);
  const factors = product.apply(sinks);
  new CosGenF32(2, widths(1), ec, 11).apply(dest1(factors[0]));
  new SinGenF32(3, widths(1), ec, 11).apply(dest1(factors[1]));
  tickThenObserve(ec);
  expectPin(ec, 1, 0, 1.0);
  expectPin(ec, 1, 1, 0.0);
  expectPin(ec, 0, 0, 0.0);
}

export function test_demo_diagram_cos_times_sin_at_one_second(): void {
  const ec = new TestExecutionContext();
  ec.setNow(1000);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(2), ec);
  const factors = product.apply(sinks);
  new CosGenF32(2, widths(1), ec).apply(dest1(factors[0]));
  new SinGenF32(3, widths(1), ec).apply(dest1(factors[1]));
  tickThenObserve(ec);
  const expected = Mathf.cos(1.0) * Mathf.sin(1.0);
  expectPin(ec, 1, 0, Mathf.cos(1.0), 1e-5);
  expectPin(ec, 1, 1, Mathf.sin(1.0), 1e-5);
  expectPin(ec, 0, 0, expected, 1e-5);
}

export function test_diagram_const_product_cos_scope(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const cos = new CosF32(1, widths(1), ec);
  const cosIn = cos.apply(sinks);
  const product = new ProductF32(2, widths(2), ec);
  const factors = product.apply(dest1(cosIn));
  new ConstF32(3, widths(1), ec, 10, Mathf.PI).apply(dest1(factors[0]));
  new ConstF32(4, widths(1), ec, 10, 1.0).apply(dest1(factors[1]));
  tickThenObserve(ec);
  expectPin(ec, 2, 0, Mathf.PI, 1e-5);
  expectPin(ec, 2, 1, 1.0);
  expectPin(ec, 1, 0, -1.0, 1e-5);
  expectPin(ec, 0, 0, -1.0, 1e-5);
}

export function test_diagram_gpio_and_const_through_product(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(2), ec);
  const factors = product.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, 4.0).apply(dest1(factors[0]));
  const gpioIn = new GpioIn(3, widths(1), ec, pins(0));
  gpioIn.apply(gpioSinks(dest1(factors[1])));
  ec.emitGpioIn(3, 0, true);
  ec.tick();
  expectPin(ec, 1, 0, 4.0);
  expectPin(ec, 1, 1, 1.0);
  ec.clearPins();
  ec.tick();
  expectPin(ec, 0, 0, 4.0);
  ec.emitGpioIn(3, 0, false);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
}

export function test_diagram_pulse_and_const_to_two_scope_channels(): void {
  const ec = new TestExecutionContext();
  ec.setNow(0);
  const scope = new ScopeF32(0, widths(2), ec);
  const sinks = scope.apply();
  new PulseGenF32(1, widths(1), ec, 10, 0.5).apply(dest1(sinks[0]));
  new ConstF32(2, widths(1), ec, 10, 3.0).apply(dest1(sinks[1]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  expectPin(ec, 0, 1, 3.0);
  ec.setNow(6);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
  expectPin(ec, 0, 1, 3.0);
}

export function test_diagram_rand_times_const(): void {
  const ec = new TestExecutionContext();
  ec.setRandom(0.5);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(2), ec);
  const factors = product.apply(sinks);
  new RandGenF32(2, widths(1), ec).apply(dest1(factors[0]));
  new ConstF32(3, widths(1), ec, 10, 8.0).apply(dest1(factors[1]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 4.0);
}

export function test_diagram_three_channel_scope_from_three_sources(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(3), ec);
  const sinks = scope.apply();
  new ConstF32(1, widths(1), ec, 10, 1.0).apply(dest1(sinks[0]));
  new SinGenF32(2, widths(1), ec).apply(dest1(sinks[1]));
  new CosGenF32(3, widths(1), ec).apply(dest1(sinks[2]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  expectPin(ec, 0, 1, 0.0);
  expectPin(ec, 0, 2, 1.0);
}
