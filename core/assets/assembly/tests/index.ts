export {
  test_const_f32_pushes_value_to_scope,
  test_const_f32_zero_to_scope,
  test_const_f32_negative_to_scope,
  test_const_f32_fans_out_to_two_scope_channels,
  test_const_f32_default_precision_is_ten,
  test_const_f32_uses_configured_precision,
  test_const_f32_on_close_stops_pushing,
} from "./const";

export {
  test_product_f32_two_constants,
  test_product_f32_three_constants,
  test_product_f32_single_factor_is_identity,
  test_product_f32_unset_factor_defaults_to_one,
  test_product_f32_fans_out_to_two_scopes,
  test_product_f32_zero_factor_zeroes_result,
  test_product_f32_negative_factors,
} from "./product";

export {
  test_cos_f32_of_zero_is_one,
  test_cos_f32_of_pi_is_minus_one,
  test_sin_f32_of_zero_is_zero,
  test_sin_f32_of_half_pi_is_one,
  test_sin_f32_of_pi_is_zero,
  test_const_cos_sin_chain,
  test_cos_f32_fans_out_to_two_scope_channels,
  test_product_then_cos,
} from "./trig";

export {
  test_scope_f32_reports_nan_before_any_push,
  test_scope_f32_channels_are_independent,
  test_scope_f32_keeps_latest_value,
  test_scope_f32_default_conf,
  test_scope_f32_custom_precision,
  test_scope_f32_three_channels_partial_feed,
  test_scope_f32_on_close_stops_sampling,
} from "./scope";

export {
  test_cos_gen_f32_at_zero_is_one,
  test_sin_gen_f32_at_zero_is_zero,
  test_cos_gen_f32_at_one_second,
  test_sin_gen_f32_at_one_second,
  test_cos_gen_through_cos_transformer,
  test_rand_gen_f32_uses_context_random,
  test_rand_gen_f32_tracks_updated_random,
  test_generators_fan_out_to_two_channels,
  test_sin_gen_and_cos_gen_to_separate_channels,
  test_generator_on_close_stops,
  test_cos_gen_default_precision,
} from "./generators";

export {
  test_pulse_gen_high_at_start_of_period,
  test_pulse_gen_low_after_duty_window,
  test_pulse_gen_high_just_inside_duty_window,
  test_pulse_gen_wraps_with_period,
  test_pulse_gen_duty_zero_always_low,
  test_pulse_gen_duty_one_always_high,
  test_pulse_gen_quarter_duty,
  test_pulse_gen_default_conf,
} from "./pulse";

export {
  test_gpio_in_true_is_one_on_scope,
  test_gpio_in_false_is_zero_on_scope,
  test_gpio_in_routes_pins_independently,
  test_gpio_in_fans_out_to_product_and_scope,
  test_gpio_in_ignores_other_block_ids,
  test_gpio_in_on_close_stops_listening,
  test_gpio_in_stores_configured_pins,
} from "./gpio";

export {
  test_demo_diagram_cos_gen_to_scope,
  test_demo_diagram_cos_times_sin_at_zero,
  test_demo_diagram_cos_times_sin_at_one_second,
  test_diagram_const_product_cos_scope,
  test_diagram_gpio_and_const_through_product,
  test_diagram_pulse_and_const_to_two_scope_channels,
  test_diagram_rand_times_const,
  test_diagram_three_channel_scope_from_three_sources,
} from "./diagrams";
