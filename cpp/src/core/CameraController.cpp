#include "core/CameraController.hpp"

#include <algorithm>

namespace core {

// 相机控制器：以玩家为中心跟随，支持死区和边界约束
CameraController::CameraController(CameraConfig config)
    : config_(config) {
}

// 直接将相机中心设置在指定位置，考虑边界约束
void CameraController::centerOn(const Vec2& worldPos, const CameraBounds& bounds) {
    const float maxX = std::max(0.0f, bounds.worldWidth - bounds.viewportWidth);
    const float maxY = std::max(0.0f, bounds.worldHeight - bounds.viewportHeight);

    position_.x = clamp(worldPos.x - bounds.viewportWidth * 0.5f, 0.0f, maxX);
    position_.y = clamp(worldPos.y - bounds.viewportHeight * 0.5f, 0.0f, maxY);
}

// 根据玩家位置更新相机，启用死区跟随平滑
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
