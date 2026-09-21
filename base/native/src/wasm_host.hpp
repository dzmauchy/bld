#pragma once

#include <bld.hpp>
#include <vector>

void register_gpio_block(u32 blockId, u16 port, std::vector<u8> pins);

extern "C" void build_diagram();
