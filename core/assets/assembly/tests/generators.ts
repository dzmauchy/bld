import { CosF32, CosGenF32, RandGenF32, ScopeF32, SinGenF32 } from "../push";
import {
  DiscardF32,
  TestExecutionContext,
  dest1,
  expectNoPin,
  expectPin,
  tickThenObserve,
  widths,
} from "./harness";

export function test_cos_gen_f32_at_zero_is_one(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new CosGenF32(1, widths(1), ec, 10).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
}

export function test_sin_gen_f32_at_zero_is_zero(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new SinGenF32(1, widths(1), ec, 10).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
}

export function test_cos_gen_f32_at_one_second(): void {
  const ec = new TestExecutionContext();
  ec.setNow(1000);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new CosGenF32(1, widths(1), ec, 10).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, Mathf.cos(1.0), 1e-5);
}

export function test_sin_gen_f32_at_one_second(): void {
  const ec = new TestExecutionContext();
  ec.setNow(1000);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new SinGenF32(1, widths(1), ec, 10).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, Mathf.sin(1.0), 1e-5);
}

export function test_cos_gen_through_cos_transformer(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const cos = new CosF32(1, widths(1), ec);
  const input = cos.apply(sinks);
  new CosGenF32(2, widths(1), ec, 10).apply(dest1(input));
  tickThenObserve(ec);
  const expected = Mathf.cos(1.0);
  expectPin(ec, 1, 0, expected, 1e-5);
  expectPin(ec, 0, 0, expected, 1e-5);
}

export function test_rand_gen_f32_uses_context_random(): void {
  const ec = new TestExecutionContext();
  ec.setRandom(0.25);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new RandGenF32(1, widths(1), ec, 10).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.25);
}

export function test_rand_gen_f32_tracks_updated_random(): void {
  const ec = new TestExecutionContext();
  ec.setRandom(0.1);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new RandGenF32(1, widths(1), ec).apply(sinks);
  ec.tick();
  ec.setRandom(0.9);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.9);
}

export function test_generators_fan_out_to_two_channels(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(2), ec);
  const sinks = scope.apply();
  new CosGenF32(1, widths(1), ec).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  expectPin(ec, 0, 1, 1.0);
}

export function test_sin_gen_and_cos_gen_to_separate_channels(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(2), ec);
  const sinks = scope.apply();
  new CosGenF32(1, widths(1), ec).apply(dest1(sinks[0]));
  new SinGenF32(2, widths(1), ec).apply(dest1(sinks[1]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  expectPin(ec, 0, 1, 0.0);
}

export function test_generator_on_close_stops(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new CosGenF32(1, widths(1), ec).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  ec.close();
  ec.clearPins();
  ec.tick();
  expectNoPin(ec, 0, 0);
}

export function test_cos_gen_default_precision(): void {
  const ec = new TestExecutionContext();
  const gen = new CosGenF32(1, widths(1), ec);
  gen.apply(dest1(new DiscardF32()));
  assert(gen.precision == 10);
  assert(ec.intervalPeriodAt(0) == 10);
}
