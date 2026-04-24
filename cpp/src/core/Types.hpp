#pragma once

#include <cstdint>

namespace core {

struct Vec2 {
    float x = 0.0f;
    float y = 0.0f;
};

struct TilePos {
    std::int32_t x = 0;
    std::int32_t y = 0;
};

enum class Facing {
    Left,
    Right,
    Up,
    Down
};

} // namespace core
