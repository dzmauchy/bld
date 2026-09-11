import { PulseGenF32, ScopeF32 } from "../push";
import {
  TestExecutionContext,
  expectPin,
  tickThenObserve,
  widths,
} from "./harness";

export function test_pulse_gen_high_at_start_of_period(): void {
  const ec = new TestExecutionContext();
  ec.setNow(0);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new PulseGenF32(1, widths(1), ec, 10, 0.5).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
}

export function test_pulse_gen_low_after_duty_window(): void {
  const ec = new TestExecutionContext();
  ec.setNow(5);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new PulseGenF32(1, widths(1), ec, 10, 0.5).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
}

export function test_pulse_gen_high_just_inside_duty_window(): void {
  const ec = new TestExecutionContext();
  ec.setNow(4);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new PulseGenF32(1, widths(1), ec, 10, 0.5).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
}

export function test_pulse_gen_wraps_with_period(): void {
  const ec = new TestExecutionContext();
  ec.setNow(10);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new PulseGenF32(1, widths(1), ec, 10, 0.5).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
}

export function test_pulse_gen_duty_zero_always_low(): void {
  const ec = new TestExecutionContext();
  ec.setNow(0);
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new PulseGenF32(1, widths(1), ec, 10, 0.0).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
}

export function test_pulse_gen_duty_one_always_high(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new PulseGenF32(1, widths(1), ec, 10, 1.0).apply(sinks);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  ec.setNow(9);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
}

export function test_pulse_gen_quarter_duty(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  new PulseGenF32(1, widths(1), ec, 20, 0.25).apply(sinks);
  ec.setNow(0);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  ec.setNow(4);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  ec.setNow(5);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
}

export function test_pulse_gen_default_conf(): void {
  const ec = new TestExecutionContext();
  const pulse = new PulseGenF32(1, widths(1), ec);
  assert(pulse.period == 10);
  assert(pulse.dutyCycle == 0.5);
}
