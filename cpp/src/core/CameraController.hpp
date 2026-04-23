#pragma once

#include "core/Types.hpp"

namespace core {

struct CameraConfig {
    float deadZoneRatioX = 0.18f;
    float topDeadZoneRatioY = 0.08f;
    float bottomDeadZoneRatioY = 0.48f;
};

struct CameraBounds {
    float worldWidth = 0.0f;
    float worldHeight = 0.0f;
    float viewportWidth = 0.0f;
    float viewportHeight = 0.0f;
};

class CameraController {
public:
    explicit CameraController(CameraConfig config);

    void centerOn(const Vec2& worldPos, const CameraBounds& bounds);
    void updateFollow(const Vec2& worldPos, const CameraBounds& bounds);

    [[nodiscard]] Vec2 position() const;

private:
    [[nodiscard]] static float clamp(float value, float min, float max);

private:
    CameraConfig config_;
    Vec2 position_{};
};

} // namespace core
