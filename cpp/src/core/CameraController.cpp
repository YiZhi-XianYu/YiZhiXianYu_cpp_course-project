#include "core/CameraController.hpp"

#include <algorithm>

namespace core {

CameraController::CameraController(CameraConfig config)
    : config_(config) {
}

void CameraController::centerOn(const Vec2& worldPos, const CameraBounds& bounds) {
    const float maxX = std::max(0.0f, bounds.worldWidth - bounds.viewportWidth);
    const float maxY = std::max(0.0f, bounds.worldHeight - bounds.viewportHeight);

    position_.x = clamp(worldPos.x - bounds.viewportWidth * 0.5f, 0.0f, maxX);
    position_.y = clamp(worldPos.y - bounds.viewportHeight * 0.5f, 0.0f, maxY);
}

void CameraController::updateFollow(const Vec2& worldPos, const CameraBounds& bounds) {
    const float deadHalfX = bounds.viewportWidth * config_.deadZoneRatioX;
    const float topDeadHalfY = bounds.viewportHeight * config_.topDeadZoneRatioY;
    const float bottomDeadHalfY = bounds.viewportHeight * config_.bottomDeadZoneRatioY;

    const float leftBoundary = position_.x + bounds.viewportWidth * 0.5f - deadHalfX;
    const float rightBoundary = position_.x + bounds.viewportWidth * 0.5f + deadHalfX;
    const float topBoundary = position_.y + bounds.viewportHeight * 0.5f - topDeadHalfY;
    const float bottomBoundary = position_.y + bounds.viewportHeight * 0.5f + bottomDeadHalfY;

    if (worldPos.x < leftBoundary) {
        position_.x = worldPos.x - (bounds.viewportWidth * 0.5f - deadHalfX);
    } else if (worldPos.x > rightBoundary) {
        position_.x = worldPos.x - (bounds.viewportWidth * 0.5f + deadHalfX);
    }

    if (worldPos.y < topBoundary) {
        position_.y = worldPos.y - (bounds.viewportHeight * 0.5f - topDeadHalfY);
    } else if (worldPos.y > bottomBoundary) {
        position_.y = worldPos.y - (bounds.viewportHeight * 0.5f + bottomDeadHalfY);
    }

    const float maxX = std::max(0.0f, bounds.worldWidth - bounds.viewportWidth);
    const float maxY = std::max(0.0f, bounds.worldHeight - bounds.viewportHeight);
    position_.x = clamp(position_.x, 0.0f, maxX);
    position_.y = clamp(position_.y, 0.0f, maxY);
}

Vec2 CameraController::position() const {
    return position_;
}

float CameraController::clamp(float value, float min, float max) {
    return std::clamp(value, min, max);
}

} // namespace core
