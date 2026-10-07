#include <base/f32_blocks.hpp>
#include "wasm_host.hpp"

// {"id":"demo","title":"Diagram Demo","blocks":{
// "scope":{"ref":"ScopeF32","x":10,"y":30},
// "cosine":{"ref":"CosGenF32","x":200,"y":20}},
// "connections":{"wire":{"from":{"block":"scope","port":{"type":"output","id":"channels"}},
// "to":{"block":"cosine","port":{"type":"input","id":"downstream"}}}}}
extern "C" void mount() {
  static auto scope = push::f_32::sinks::ScopeF32(0u);
  static auto cosine = push::f_32::sources::CosGenF32(1u);
  auto channels = scope().channels(1);
  cosine({.downstream = channels});
}
