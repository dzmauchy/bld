import { ConstF32, ProductF32, ScopeF32 } from "../push";
import {
  TestExecutionContext,
  dest1,
  dest2,
  expectPin,
  tickThenObserve,
  widths,
} from "./harness";

export function test_product_f32_two_constants(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(2), ec);
  const factors = product.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, 3.0).apply(dest1(factors[0]));
  new ConstF32(3, widths(1), ec, 10, 4.0).apply(dest1(factors[1]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 12.0);
  expectPin(ec, 1, 0, 3.0);
  expectPin(ec, 1, 1, 4.0);
}

export function test_product_f32_three_constants(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(3), ec);
  const factors = product.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, 2.0).apply(dest1(factors[0]));
  new ConstF32(3, widths(1), ec, 10, 3.0).apply(dest1(factors[1]));
  new ConstF32(4, widths(1), ec, 10, 5.0).apply(dest1(factors[2]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 30.0);
  expectPin(ec, 1, 0, 2.0);
  expectPin(ec, 1, 1, 3.0);
  expectPin(ec, 1, 2, 5.0);
}

export function test_product_f32_single_factor_is_identity(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(1), ec);
  const factors = product.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, 7.5).apply(factors);
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 7.5);
  expectPin(ec, 1, 0, 7.5);
}

export function test_product_f32_unset_factor_defaults_to_one(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(2), ec);
  const factors = product.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, 6.0).apply(dest1(factors[0]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 6.0);
  expectPin(ec, 1, 0, 6.0);
}

export function test_product_f32_fans_out_to_two_scopes(): void {
  const ec = new TestExecutionContext();
  const left = new ScopeF32(0, widths(1), ec);
  const right = new ScopeF32(1, widths(1), ec);
  const product = new ProductF32(2, widths(2), ec);
  const factors = product.apply(dest2(left.apply()[0], right.apply()[0]));
  new ConstF32(3, widths(1), ec, 10, 2.0).apply(dest1(factors[0]));
  new ConstF32(4, widths(1), ec, 10, 9.0).apply(dest1(factors[1]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 18.0);
  expectPin(ec, 1, 0, 18.0);
}

export function test_product_f32_zero_factor_zeroes_result(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(2), ec);
  const factors = product.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, 0.0).apply(dest1(factors[0]));
  new ConstF32(3, widths(1), ec, 10, 11.0).apply(dest1(factors[1]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, 0.0);
}

export function test_product_f32_negative_factors(): void {
  const ec = new TestExecutionContext();
  const scope = new ScopeF32(0, widths(1), ec);
  const sinks = scope.apply();
  const product = new ProductF32(1, widths(2), ec);
  const factors = product.apply(sinks);
  new ConstF32(2, widths(1), ec, 10, -2.0).apply(dest1(factors[0]));
  new ConstF32(3, widths(1), ec, 10, 5.0).apply(dest1(factors[1]));
  tickThenObserve(ec);
  expectPin(ec, 0, 0, -10.0);
}
