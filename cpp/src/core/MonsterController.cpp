#include "core/MonsterController.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>
#include <queue>
#include <utility>

namespace core {

namespace {

float clamp01(float value) {
    return std::clamp(value, 0.0f, 1.0f);
}

float lerp(float start, float end, float t) {
    return start + (end - start) * t;
}

float easeInOutQuad(float t) {
    if (t < 0.5f) return 2.0f * t * t;
    return 1.0f - std::pow(-2.0f * t + 2.0f, 2.0f) / 2.0f;
}

} // namespace

MonsterController::MonsterController(MonsterConfig config, MonsterRole role)
    : config_(config),
      role_(std::move(role)),
      currentHp_(role_.stats().maxHp),
      rng_(std::random_device{}()) {
}

void MonsterController::setSpawn(TilePos spawn) {
    tilePos_ = spawn;
    worldPos_ = tileToWorld(spawn);
    facing_ = Facing::Left;
    discovered_ = false;
    currentHp_ = role_.stats().maxHp;
    hurt_ = false;
    dead_ = false;
    deathAnimationFinished_ = false;
    removed_ = false;
    hurtStartTimeMs_ = 0.0f;
    deathStartTimeMs_ = 0.0f;

    move_ = MoveState{};
    attacking_ = false;
    attackVariant_ = 0;
    attackImpactResolved_ = false;
    attackImpactConsumed_ = false;
    attackStartTimeMs_ = 0.0f;
    lastAttackTimeMs_ = -1000000.0f;
    lastProcessedPlayerTurn_ = -1;
}

void MonsterController::onMapSwitched() {
    discovered_ = false;
    lastProcessedPlayerTurn_ = -1;
}

void MonsterController::applyDamage(std::int32_t damage, float nowMs, std::optional<TilePos> attackerTile) {
    if (dead_ || removed_ || damage <= 0) return;

    currentHp_ = std::max(0, currentHp_ - damage);
    hurt_ = true;
    hurtStartTimeMs_ = nowMs;

    if (attackerTile.has_value()) {
        const std::int32_t detectRadius = 7;
        const std::int32_t dx = std::abs(attackerTile->x - tilePos_.x);
        const std::int32_t dy = std::abs(attackerTile->y - tilePos_.y);
        if (dx <= detectRadius && dy <= detectRadius) {
            discovered_ = true;
        }
    }

    if (currentHp_ <= 0) {
        dead_ = true;
        deathAnimationFinished_ = false;
        deathStartTimeMs_ = nowMs;
        attacking_ = false;
        move_ = MoveState{};
        attackVariant_ = 0;
    }
}

void MonsterController::update(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    if (hurt_ && (nowMs - hurtStartTimeMs_ >= config_.hurtDurationMs)) {
        hurt_ = false;
    }

    if (dead_) {
        attacking_ = false;
        move_.active = false;
        attackVariant_ = 0;
        if (!deathAnimationFinished_ && (nowMs - deathStartTimeMs_ >= config_.deathDurationMs)) {
            deathAnimationFinished_ = true;
            removed_ = true;
        }
        (void)isBlocked;
        return;
    }

    if (move_.active) {
        const float elapsed = nowMs - move_.startTimeMs;
        const float progress = clamp01(elapsed / std::max(1.0f, config_.moveDurationMs));
        const float eased = easeInOutQuad(progress);

        worldPos_.x = lerp(move_.startWorld.x, move_.targetWorld.x, eased);
        worldPos_.y = lerp(move_.startWorld.y, move_.targetWorld.y, eased);

        if (progress >= 1.0f) {
            finishMove();
        }
    }

    if (attacking_) {
        const float elapsedAttack = nowMs - attackStartTimeMs_;
        const float attackDuration = std::max(1.0f, config_.attackDurationMs);
        if (!attackImpactResolved_ && elapsedAttack >= attackDuration * 0.5f) {
            attackImpactResolved_ = true;
        }
        if (elapsedAttack >= attackDuration) {
            attacking_ = false;
            attackVariant_ = 0;
        }
    }

    (void)isBlocked;
}

void MonsterController::onPlayerTurnAdvanced(
    std::int32_t playerTurn,
    TilePos playerTile,
    float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    if (playerTurn <= lastProcessedPlayerTurn_) return;
    lastProcessedPlayerTurn_ = playerTurn;

    if (dead_ || removed_ || move_.active || attacking_) return;

    if (!discovered_ && inDiscoverRange(playerTile)) {
        discovered_ = true;
    }

    if (!discovered_) {
        randomPatrol(nowMs, isBlocked);
        return;
    }

    faceTo(playerTile);

    if (inAttackRange(playerTile)) {
        startAttack(nowMs);
        return;
    }

    const auto nextStep = nextShortestStepToward(playerTile, isBlocked);
    if (nextStep.has_value()) {
        startMove(nextStep.value(), nowMs);
    }
}

const MonsterRole& MonsterController::role() const {
    return role_;
}

TilePos MonsterController::tilePos() const {
    return tilePos_;
}

Vec2 MonsterController::worldPos() const {
    return worldPos_;
}

Facing MonsterController::facing() const {
    return facing_;
}

bool MonsterController::isDiscovered() const {
    return discovered_;
}

bool MonsterController::isWalkingAnimation() const {
    return move_.active && !dead_ && !removed_;
}

bool MonsterController::isAttacking() const {
    return attacking_ && !dead_ && !removed_;
}

bool MonsterController::isHurt() const {
    return hurt_;
}

bool MonsterController::isDead() const {
    return dead_;
}

bool MonsterController::isRemoved() const {
    return removed_;
}

std::int32_t MonsterController::attackVariant() const {
    return attackVariant_;
}

bool MonsterController::consumeAttackImpactReady() {
    if (!attacking_) return false;
    if (!attackImpactResolved_) return false;
    if (attackImpactConsumed_) return false;
    attackImpactConsumed_ = true;
    return true;
}

std::int32_t MonsterController::currentHp() const {
    return currentHp_;
}

std::vector<TilePos> MonsterController::attackAreaTiles() const {
    if (!attacking_ || dead_ || removed_) return {};

    std::vector<TilePos> area;
    area.reserve(9);
    for (std::int32_t dy = -1; dy <= 1; ++dy) {
        for (std::int32_t dx = -1; dx <= 1; ++dx) {
            area.push_back(TilePos{tilePos_.x + dx, tilePos_.y + dy});
        }
    }
    return area;
}

Vec2 MonsterController::tileToWorld(TilePos tilePos) const {
    return {
        (static_cast<float>(tilePos.x) + 0.5f) * config_.tileWidth * config_.worldScale,
        ((static_cast<float>(tilePos.y) + 1.0f) * config_.tileHeight - config_.feetOffsetY) * config_.worldScale
    };
}

TilePos MonsterController::directionToTileOffset(Facing facing) {
    switch (facing) {
        case Facing::Left:  return {-1, 0};
        case Facing::Right: return {1, 0};
        case Facing::Up:    return {0, -1};
        case Facing::Down:  return {0, 1};
        default:            return {0, 0};
    }
}

bool MonsterController::inDiscoverRange(TilePos playerTile) const {
    const std::int32_t dx = std::abs(playerTile.x - tilePos_.x);
    const std::int32_t dy = std::abs(playerTile.y - tilePos_.y);
    return dx <= role_.vision().discoverRadius && dy <= role_.vision().discoverRadius;
}

bool MonsterController::inAttackRange(TilePos playerTile) const {
    const std::int32_t radius = std::max(1, role_.normalAttack().rangeRadius);
    const std::int32_t dx = std::abs(playerTile.x - tilePos_.x);
    const std::int32_t dy = std::abs(playerTile.y - tilePos_.y);
    return dx <= radius && dy <= radius;
}

void MonsterController::faceTo(TilePos target) {
    const std::int32_t dx = target.x - tilePos_.x;
    const std::int32_t dy = target.y - tilePos_.y;
    if (std::abs(dx) >= std::abs(dy)) {
        facing_ = (dx >= 0) ? Facing::Right : Facing::Left;
    } else {
        facing_ = (dy >= 0) ? Facing::Down : Facing::Up;
    }
}

void MonsterController::startAttack(float nowMs) {
    if (dead_ || removed_) return;
    attacking_ = true;
    attackImpactResolved_ = false;
    attackImpactConsumed_ = false;
    attackStartTimeMs_ = nowMs;
    lastAttackTimeMs_ = nowMs;

    std::uniform_int_distribution<std::int32_t> attackPicker(1, std::max(1, role_.normalAttack().variants));
    attackVariant_ = attackPicker(rng_);
}

void MonsterController::startMove(TilePos nextTile, float nowMs) {
    if (dead_ || removed_) return;
    if (nextTile.x < tilePos_.x) facing_ = Facing::Left;
    else if (nextTile.x > tilePos_.x) facing_ = Facing::Right;
    else if (nextTile.y < tilePos_.y) facing_ = Facing::Up;
    else if (nextTile.y > tilePos_.y) facing_ = Facing::Down;

    move_.active = true;
    move_.startTimeMs = nowMs;
    move_.startWorld = worldPos_;
    move_.targetWorld = tileToWorld(nextTile);
    move_.targetTile = nextTile;
}

bool MonsterController::tryMoveBy(TilePos offset, float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    if (dead_ || removed_) return false;
    const TilePos next{tilePos_.x + offset.x, tilePos_.y + offset.y};
    if (isBlocked(next.x, next.y)) {
        return false;
    }

    startMove(next, nowMs);
    return true;
}

void MonsterController::randomPatrol(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    if (dead_ || removed_) return;
    std::array<TilePos, 4> candidates {
        TilePos{-1, 0}, TilePos{1, 0}, TilePos{0, -1}, TilePos{0, 1}
    };

    std::shuffle(candidates.begin(), candidates.end(), rng_);

    for (const TilePos step : candidates) {
        if (tryMoveBy(step, nowMs, isBlocked)) {
            return;
        }
    }
}

std::optional<TilePos> MonsterController::nextShortestStepToward(
    TilePos target,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) const {
    if (tilePos_.x == target.x && tilePos_.y == target.y) {
        return std::nullopt;
    }

    const std::int32_t maxSearchRadius = 32;
    const std::int32_t minX = std::min(tilePos_.x, target.x) - maxSearchRadius;
    const std::int32_t maxX = std::max(tilePos_.x, target.x) + maxSearchRadius;
    const std::int32_t minY = std::min(tilePos_.y, target.y) - maxSearchRadius;
    const std::int32_t maxY = std::max(tilePos_.y, target.y) + maxSearchRadius;
    const std::int32_t width = maxX - minX + 1;
    const std::int32_t height = maxY - minY + 1;

    if (width <= 0 || height <= 0) return std::nullopt;

    const auto indexOf = [=](TilePos p) {
        return (p.y - minY) * width + (p.x - minX);
    };

    const TilePos invalidPrev{std::numeric_limits<std::int32_t>::min(), std::numeric_limits<std::int32_t>::min()};

    std::vector<std::uint8_t> visited(static_cast<std::size_t>(width * height), 0);
    std::vector<TilePos> prev(static_cast<std::size_t>(width * height), invalidPrev);
    std::queue<TilePos> frontier;

    frontier.push(tilePos_);
    visited[static_cast<std::size_t>(indexOf(tilePos_))] = 1;

    const std::array<TilePos, 4> dirs{TilePos{-1, 0}, TilePos{1, 0}, TilePos{0, -1}, TilePos{0, 1}};

    bool found = false;
    while (!frontier.empty()) {
        const TilePos current = frontier.front();
        frontier.pop();

        if (current.x == target.x && current.y == target.y) {
            found = true;
            break;
        }

        for (const TilePos d : dirs) {
            const TilePos next{current.x + d.x, current.y + d.y};
            if (next.x < minX || next.x > maxX || next.y < minY || next.y > maxY) continue;

            const std::int32_t nextIndex = indexOf(next);
            if (visited[static_cast<std::size_t>(nextIndex)] != 0) continue;
            // 目标点是玩家所在格时，允许作为搜索终点参与路径计算；
            // 这样可求得“朝玩家最短路径前进一步”的方向，同时不会真的走进玩家格。
            const bool isTargetTile = (next.x == target.x && next.y == target.y);
            if (!isTargetTile && isBlocked(next.x, next.y)) continue;

            visited[static_cast<std::size_t>(nextIndex)] = 1;
            prev[static_cast<std::size_t>(nextIndex)] = current;
            frontier.push(next);
        }
    }

    if (!found) {
        return std::nullopt;
    }

    TilePos cursor = target;
    TilePos parent = prev[static_cast<std::size_t>(indexOf(cursor))];

    while (!(parent.x == tilePos_.x && parent.y == tilePos_.y)) {
        cursor = parent;
        const TilePos nextParent = prev[static_cast<std::size_t>(indexOf(cursor))];
        if (nextParent.x == invalidPrev.x && nextParent.y == invalidPrev.y) {
            return std::nullopt;
        }
        parent = nextParent;
    }

    return cursor;
}

void MonsterController::finishMove() {
    tilePos_ = move_.targetTile;
    worldPos_ = move_.targetWorld;
    move_.active = false;
}

} // namespace core
