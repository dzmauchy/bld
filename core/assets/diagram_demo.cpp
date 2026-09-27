#include <base/f32_blocks.hpp>
#include "wasm_host.hpp"

// {"id":"demo","title":"Diagram Demo","blocks":{
// "scope":{"ref":"ScopeF32","x":10,"y":30},
// "cosine":{"ref":"CosGenF32","x":200,"y":20}},
// "connections":{"wire":{"from":{"block":"scope","port":{"type":"output","id":"channels"}},
// "to":{"block":"cosine","port":{"type":"input","id":"downstream"}}}}}
extern "C" void mount() {
  auto* scope = new push::f32::sinks::ScopeF32<>(0u);
  auto* cosine = new push::f32::sources::CosGenF32<>(1u);
  auto channels = scope->apply({.channelCount = 1});
  cosine->apply({.downstream = {channels.channels[0]}});
}
