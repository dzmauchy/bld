#pragma once

#include <bld.hpp>

class ScopeF32 : Block {
 public:
  explicit ScopeF32(const u32 blockId) : Block(blockId) {}

  Consumer<f32> operator()() 
};