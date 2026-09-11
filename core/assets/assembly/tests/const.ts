import { ConstF32, ScopeF32 } from "../push";
import {
  DiscardF32,
  TestExecutionContext,
  dest1,
  expectNoPin,
  expectPin,
  tickThenObserve,
  widths,
} from "./harness";

export function test_const_f32_pushes_value_to_scope(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec, 60, 10);
  const sinks = scope.apply();
  const constant = new ConstF32(1, widths(1), ec, 10, 3.5);
  constant.apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 3.5);
}

export function test_const_f32_zero_to_scope(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const constant = new ConstF32(1, widths(1), ec, 10, 0.0);
  constant.apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
}

export function test_const_f32_negative_to_scope(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const constant = new ConstF32(1, widths(1), ec, 10, -2.25);
  constant.apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, -2.25);
}

export function test_const_f32_fans_out_to_two_scope_channels(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(2), ec, 60, 10);
  const sinks = scope.apply();
  const constant = new ConstF32(1, widths(1), ec, 10, 8.0);
  constant.apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 8.0);
  expectPin(ec, 0, 1, 8.0);
}

export function test_const_f32_default_precision_is_ten(): void {
  const ec = new TestExecutionContext();
  const constant = new ConstF32(1, widths(1), ec);
  constant.apply(dest1(new DiscardF32()));
  assert(constant.precision == 10);
  assert(ec.intervalPeriodAt(0) == 10);
}

export function test_const_f32_uses_configured_precision(): void {
  const ec = new TestExecutionContext();
  const constant = new ConstF32(1, widths(1), ec, 25, 1.0);
  constant.apply(dest1(new DiscardF32()));
  assert(ec.intervalPeriodAt(0) == 25);
}

export function test_const_f32_on_close_stops_pushing(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const constant = new ConstF32(1, widths(1), ec, 10, 9.0);
  constant.apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 9.0);
  ec.close();
  assert(ec.activeIntervalCount() == 0);
  ec.clearPins();
  ec.tick();
  expectNoPin(ec, 0, 0);
}
