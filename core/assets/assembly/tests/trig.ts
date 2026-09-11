import { ConstF32, CosF32, ProductF32, ScopeF32, SinF32 } from "../push";
import {
  TestExecutionContext,
  dest1,
  expectPin,
  tickThenObserve,
  widths,
} from "./harness";

export function test_cos_f32_of_zero_is_one(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const cos = new CosF32(1, widths(1), ec);
  const input = cos.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, 0.0).apply(dest1(input));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  expectPin(ec, 1, 0, 1.0);
}

export function test_cos_f32_of_pi_is_minus_one(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const cos = new CosF32(1, widths(1), ec);
  const input = cos.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, Mathf.PI).apply(dest1(input));
  tickThenObserve(ec);
  expectPin(ec, 1, 0, -1.0, 1e-5);
  expectPin(ec, 0, 0, -1.0, 1e-5);
}

export function test_sin_f32_of_zero_is_zero(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const sin = new SinF32(1, widths(1), ec);
  const input = sin.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, 0.0).apply(dest1(input));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
  expectPin(ec, 1, 0, 0.0);
}

export function test_sin_f32_of_half_pi_is_one(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const sin = new SinF32(1, widths(1), ec);
  const input = sin.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, Mathf.PI * 0.5).apply(dest1(input));
  tickThenObserve(ec);
  expectPin(ec, 1, 0, 1.0, 1e-5);
  expectPin(ec, 0, 0, 1.0, 1e-5);
}

export function test_sin_f32_of_pi_is_zero(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const sin = new SinF32(1, widths(1), ec);
  const input = sin.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, Mathf.PI).apply(dest1(input));
  tickThenObserve(ec);
  expectPin(ec, 1, 0, 0.0, 1e-5);
}

export function test_const_cos_sin_chain(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const sin = new SinF32(1, widths(1), ec);
  const sinIn = sin.apply(sinks);
  const cos = new CosF32(2, widths(1), ec);
  const cosIn = cos.apply(dest1(sinIn));
  new ConstF32(3, widths(1), ec, 10, 0.0).apply(dest1(cosIn));
  tickThenObserve(ec);
  const expected = Mathf.sin(1.0);
  expectPin(ec, 2, 0, 1.0);
  expectPin(ec, 1, 0, expected, 1e-5);
  expectPin(ec, 0, 0, expected, 1e-5);
}

export function test_cos_f32_fans_out_to_two_scope_channels(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(2), ec);
  const sinks = scope.apply();
  const cos = new CosF32(1, widths(1), ec);
  const input = cos.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, 0.0).apply(dest1(input));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 1.0);
  expectPin(ec, 0, 1, 1.0);
}

export function test_product_then_cos(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const cos = new CosF32(1, widths(1), ec);
  const cosIn = cos.apply(sinks);
  const product = new ProductF32(2, widths(2), ec);
  const factors = product.apply(dest1(cosIn));
  new ConstF32(3, widths(1), ec, 10, 0.0).apply(dest1(factors[0]));
  new ConstF32(4, widths(1), ec, 10, 0.0).apply(dest1(factors[1]));
  tickThenObserve(ec);
  expectPin(ec, 1, 0, 1.0);
  expectPin(ec, 0, 0, 1.0);
}
