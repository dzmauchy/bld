import { ConstF32, ScopeF32 } from "../push";
import {
  TestExecutionContext,
  dest1,
  expectNoPin,
  expectPin,
  tickThenObserve,
  widths,
} from "./harness";

export function test_scope_f32_reports_nan_before_any_push(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(2), ec, 60, 10);
  scope.apply();
  ec.tick();
  expectPin(ec, 0, 0, f32.NaN);
  expectPin(ec, 0, 1, f32.NaN);
}

export function test_scope_f32_channels_are_independent(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(2), ec);
  const sinks = scope.apply();
  new ConstF32(1, widths(1), ec, 10, 1.5).apply(dest1(sinks[0]));
  new ConstF32(2, widths(1), ec, 10, 9.5).apply(dest1(sinks[1]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.5);
  expectPin(ec, 0, 1, 9.5);
}

export function test_scope_f32_keeps_latest_value(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const constant = new ConstF32(1, widths(1), ec, 10, 1.0);
  constant.apply(sinks);
  ec.tick();
  constant.v = 4.0;
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 4.0);
}

export function test_scope_f32_default_conf(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  assert(scope.period == 60);
  assert(scope.precision == 10);
  scope.apply();
  assert(ec.intervalPeriodAt(0) == 10);
}

export function test_scope_f32_custom_precision(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec, 30, 11);
  scope.apply();
  assert(scope.period == 30);
  assert(scope.precision == 11);
  assert(ec.intervalPeriodAt(0) == 11);
}

export function test_scope_f32_three_channels_partial_feed(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(3), ec);
  const sinks = scope.apply();
  new ConstF32(1, widths(1), ec, 10, 2.0).apply(dest1(sinks[0]));
  new ConstF32(2, widths(1), ec, 10, 3.0).apply(dest1(sinks[2]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 2.0);
  expectPin(ec, 0, 1, f32.NaN);
  expectPin(ec, 0, 2, 3.0);
}

export function test_scope_f32_on_close_stops_sampling(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new ConstF32(1, widths(1), ec, 10, 1.0).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  ec.close();
  ec.clearPins();
  ec.tick();
  expectNoPin(ec, 0, 0);
}
