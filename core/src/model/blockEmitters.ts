/**
 * @title Block Emitters
 */
export {
  PUSH_BLOCK_REFS,
  TICK_BLOCK_REFS,
} from "../wasm/program";

export const defaultBlockEmitters = {
  has(ref: string): boolean {
    return (
      ref === "scope_f32" ||
      ref === "product_f32" ||
      ref === "cos_f32" ||
      ref === "sin_f32" ||
      ref === "cos_gen_f32" ||
      ref === "sin_gen_f32" ||
      ref === "rand_gen_f32" ||
      ref === "pulse_gen_f32" ||
      ref === "const_f32" ||
      ref === "gpio_in"
    );
  },
};
