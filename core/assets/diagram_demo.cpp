#include <base.hpp>
#include "wasm_host.hpp"

using push::f32::F32;

// {"id":"2026_09_09T10_11_07_089_7865FB06",
// "title":"Diagram Demo",
// "blocks":{"scope_f32_0":{
// "ref":"scope_f32",
// "x":10,"y":30,"conf":{
// "period":30,"precision":11}
// },"cos_gen_f32_0":{
// "ref":"cos_gen_f32",
// "x":200,"y":20,"conf":{
// "precision":11}}
// ,"sin_gen_f32_0":{
// "ref":"sin_gen_f32",
// "x":200,"y":120}
// ,"product_f32_0":{
// "ref":"product_f32",
// "x":90,"y":20},"gpio_in_0":{
// "ref":"gpio_in_f32",
// "x":90,"y":300,"conf":{
// "pins":[0,1,4]}}
// },"connections":{
// "cos_gen_f32_0__scope_f32_0":{
// "from":{"block":"cos_gen_f32_0",
// "port":{"type":"input",
// "id":"v","vector_index":0}
// },"to":{"block":"scope_f32_0",
// "port":{"type":"output",
// "id":"sink","vector_index":0}
// }}}}
extern "C" void mount() {
  auto* scope_f32_0 = new push::f32::sinks::ScopeF32(0u, 30u, 11u);
  auto* cos_gen_f32_0 = new push::f32::sources::CosGenF32(1u, 11u, 1.f, 1.f, 0.f);
  auto* sin_gen_f32_0 = new push::f32::sources::SinGenF32(2u, 10u, 1.f, 1.f, 0.f);
  auto* product_f32_0 = new push::f32::transformers::ProductF32(3u, 10u);
  u8 gpio_in_0_pins_items[3] = {0, 1, 4};
  auto gpio_in_0_pins = arrayFrom(gpio_in_0_pins_items, 3u);
  auto* gpio_in_0 = new push::f32::sources::GpioInF32(4u, 0, static_cast<Array<u8>&&>(gpio_in_0_pins));

  auto scope_f32_0_in = scope_f32_0->apply(static_cast<u8>(1));
  auto sin_gen_f32_0_dn = VectorizedInput<Pss<F32>>{};
  sin_gen_f32_0->apply(static_cast<VectorizedInput<Pss<F32>>&&>(sin_gen_f32_0_dn));
  auto product_f32_0_dn = VectorizedInput<Pss<F32>>{};
  auto product_f32_0_in = product_f32_0->apply(static_cast<VectorizedInput<Pss<F32>>&&>(product_f32_0_dn), static_cast<u8>(1));
  auto gpio_in_0_p0 = VectorizedInput<Pss<F32>>{};
  gpio_in_0->connectPin(static_cast<u8>(0), static_cast<VectorizedInput<Pss<F32>>&&>(gpio_in_0_p0));
  auto gpio_in_0_p1 = VectorizedInput<Pss<F32>>{};
  gpio_in_0->connectPin(static_cast<u8>(1), static_cast<VectorizedInput<Pss<F32>>&&>(gpio_in_0_p1));
  auto gpio_in_0_p2 = VectorizedInput<Pss<F32>>{};
  gpio_in_0->connectPin(static_cast<u8>(2), static_cast<VectorizedInput<Pss<F32>>&&>(gpio_in_0_p2));
  gpio_in_0->apply();
  u8 gpio_in_0_hw_items[3] = {0, 1, 4};
  auto gpio_in_0_hw = arrayFrom(gpio_in_0_hw_items, 3u);
  register_gpio_block(4u, 0, gpio_in_0_hw);
  Pss<F32>* cos_gen_f32_0_dn_items[1] = {scope_f32_0_in[0]};
  auto cos_gen_f32_0_dn = arrayFrom(cos_gen_f32_0_dn_items, 1u);
  cos_gen_f32_0->apply(static_cast<VectorizedInput<Pss<F32>>&&>(cos_gen_f32_0_dn));
}
