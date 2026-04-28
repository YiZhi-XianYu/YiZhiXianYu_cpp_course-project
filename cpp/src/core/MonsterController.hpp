#pragma once

#include <cstdint>
#include <functional>
#include <optional>
#include <random>
#include <vector>

#include "core/MonsterRole.hpp"
#include "core/Types.hpp"

namespace core {

struct MonsterConfig {
    float tileWidth = 32.0f;
    float tileHeight = 32.0f;
    float worldScale = 2.0f;
    float feetOffsetY = 8.0f;
    float moveDurationMs = 180.0f;
    float attackDurationMs = 1000.0f;
    float hurtDurationMs = 420.0f;
    float deathDurationMs = 420.0f;
};

class MonsterController {
public:
    explicit MonsterController(MonsterConfig config, MonsterRole role = MonsterRole::goblin());

    void setSpawn(TilePos spawn);
    void setHp(std::int32_t hp);
    void onMapSwitched();
    void applyDamage(std::int32_t damage, float nowMs, std::optional<TilePos> attackerTile = std::nullopt);
    void update(float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked);
    void onPlayerTurnAdvanced(
        std::int32_t playerTurn,
        TilePos playerTile,
        float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked);

    [[nodiscard]] const MonsterRole& role() const;
    [[nodiscard]] TilePos tilePos() const;
    [[nodiscard]] Vec2 worldPos() const;
    [[nodiscard]] Facing facing() const;
    [[nodiscard]] bool isDiscovered() const;
    [[nodiscard]] bool isWalkingAnimation() const;
    [[nodiscard]] bool isAttacking() const;
    [[nodiscard]] bool isHurt() const;
    [[nodiscard]] bool isDead() const;
    [[nodiscard]] bool isRemoved() const;
    [[nodiscard]] std::int32_t attackVariant() const;
    [[nodiscard]] bool consumeAttackImpactReady();
    [[nodiscard]] std::int32_t currentHp() const;
    [[nodiscard]] std::vector<TilePos> attackAreaTiles() const;
    [[nodiscard]] std::int32_t castingSkillId() const;
    [[nodiscard]] bool consumeSkillImpactReady();

private:
    struct MoveState {
        bool active = false;
        float startTimeMs = 0.0f;
        Vec2 startWorld{};
        Vec2 targetWorld{};
        TilePos targetTile{};
    };

    [[nodiscard]] Vec2 tileToWorld(TilePos tilePos) const;
    [[nodiscard]] static TilePos directionToTileOffset(Facing facing);
    [[nodiscard]] bool inDiscoverRange(TilePos playerTile) const;
    [[nodiscard]] bool inAttackRange(TilePos playerTile) const;
    std::int32_t castingSkillId_ = 0;
    bool skillImpactConsumed_ = false;
    std::array<std::int32_t, 3> skillCooldowns_{0, 0, 0};
    std::int32_t globalSkillCooldown_ = 0;
    void faceTo(TilePos target);
    void startAttack(float nowMs);
    void startMove(TilePos nextTile, float nowMs);
    bool tryMoveBy(TilePos offset, float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked);
    void randomPatrol(float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked);
    [[nodiscard]] std::optional<TilePos> nextShortestStepToward(
        TilePos target,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) const;
    void finishMove();

private:
    MonsterConfig config_;
    MonsterRole role_;

    TilePos tilePos_{};
    Vec2 worldPos_{};
    Facing facing_ = Facing::Left;

    bool discovered_ = false;
    std::int32_t currentHp_ = 0;
    bool hurt_ = false;
    bool dead_ = false;
    bool deathAnimationFinished_ = false;
    bool removed_ = false;
    float hurtStartTimeMs_ = 0.0f;
    float deathStartTimeMs_ = 0.0f;

    MoveState move_{};

    bool attacking_ = false;
    std::int32_t attackVariant_ = 0;
    bool attackImpactResolved_ = false;
    bool attackImpactConsumed_ = false;
    float attackStartTimeMs_ = 0.0f;
    float lastAttackTimeMs_ = -1000000.0f;

    std::int32_t lastProcessedPlayerTurn_ = -1;

    mutable std::mt19937 rng_;
};

} // namespace core
