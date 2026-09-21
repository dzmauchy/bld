#pragma once

#include <bld.hpp>

void register_gpio_block(u32 blockId, u16 port, const Array<u8>& pins);

extern "C" void build_diagram();
