#pragma once

#include <cstdint>
#include <functional>
#include <optional>
#include <vector>

#include "core/CharacterRole.hpp"
#include "core/Types.hpp"

namespace core {

struct PlayerConfig {
    float tileWidth = 32.0f;
    float tileHeight = 32.0f;
    float worldScale = 2.0f;
    float feetOffsetY = 8.0f;
    float moveDurationMs = 180.0f;
    float attackDurationMs = 420.0f;
    float hurtDurationMs = 420.0f;
    float deathDurationMs = 420.0f;
};

class PlayerController {
public:
    explicit PlayerController(PlayerConfig config, CharacterRole role = CharacterRole::plainPhysicalMage());

    void setSpawn(TilePos spawn);
    void setPlayerHp(std::int32_t hp);

    void requestMove(std::int32_t dx, std::int32_t dy,
        float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked,
        const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy);

    void requestAttack(float nowMs);
    void requestSmallSkill(float nowMs);
    void requestBigSkill(float nowMs);
    void applyDamage(std::int32_t damage, float nowMs);
    void revive(float nowMs);

    void update(float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked,
        const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy,
        bool allowActionStart = true);

    [[nodiscard]] bool isMoving() const;
    [[nodiscard]] bool isAttacking() const;
    [[nodiscard]] bool isBigSkillCasting() const;
    [[nodiscard]] bool isHurt() const;
    [[nodiscard]] bool isDead() const;
    [[nodiscard]] bool deathAnimationFinished() const;
    [[nodiscard]] Facing facing() const;
    [[nodiscard]] bool isWalkingAnimation() const;
    [[nodiscard]] std::int32_t attackVariant() const;
    [[nodiscard]] std::int32_t attackDamageScalePercent() const;
    [[nodiscard]] bool attackUsesAutoLock() const;
    [[nodiscard]] bool consumeAttackImpactReady();
    [[nodiscard]] bool isSmallSkillActive() const;
    [[nodiscard]] std::int32_t smallSkillTurnsLeft() const;
    [[nodiscard]] std::int32_t smallSkillCooldownTurnsLeft() const;
    [[nodiscard]] std::int32_t bigSkillCooldownTurnsLeft() const;
    [[nodiscard]] std::int32_t currentAttackPower() const;
    [[nodiscard]] std::int32_t currentHp() const;
    [[nodiscard]] bool isBigWaveActive() const;
    [[nodiscard]] bool isArcherBlessingActive() const;
    [[nodiscard]] bool consumeArcherVolleyReady();
    [[nodiscard]] TilePos bigWaveOriginTile() const;
    [[nodiscard]] std::int32_t bigWaveFrontDistance() const;
    [[nodiscard]] Facing bigWaveFacing() const;
    [[nodiscard]] std::int32_t currentTurn() const;
    [[nodiscard]] std::vector<TilePos> attackAreaTiles() const;
    [[nodiscard]] std::vector<TilePos> bigWaveTiles() const;
    [[nodiscard]] const CharacterRole& role() const;

    [[nodiscard]] TilePos tilePos() const;
    [[nodiscard]] Vec2 worldPos() const;

private:
    struct MoveRequest {
        std::int32_t dx = 0;
        std::int32_t dy = 0;
    };

    struct BigWaveState {
        bool active = false;
        TilePos originTile{};
        Facing facing = Facing::Right;
        std::int32_t frontDistance = 0;
    };

    void resetAttackChain();
    void onTurnAdvanced();
    void updateBigWavePerTurn();
    [[nodiscard]] bool smallSkillReady() const;
    [[nodiscard]] bool bigSkillReady() const;
    void requestSkill(SkillSlot slot, float nowMs);
    void tryStartNextAction(float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked,
        const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy);
    void startMoveAction(const MoveRequest& action, float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked);
    void startAttackAction(float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy);
    void startSmallSkillAction(float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked,
        const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy);
    void startBigSkillAction(float nowMs);
    void finishAttack(float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked);
    void clearPendingActions();
    [[nodiscard]] static TilePos forwardVector(Facing facing);
    [[nodiscard]] static TilePos leftVector(Facing facing);
    [[nodiscard]] static TilePos rightVector(Facing facing);
    [[nodiscard]] static TilePos backwardVector(Facing facing);
    [[nodiscard]] std::vector<TilePos> smallSkillAttackTiles() const;
    [[nodiscard]] std::vector<TilePos> bigWaveCurrentTiles() const;

    [[nodiscard]] Vec2 tileToWorld(TilePos tilePos) const;
    void finishMove(float nowMs,
        const std::function<bool(std::int32_t, std::int32_t)>& isBlocked);

private:
    PlayerConfig config_;
    CharacterRole role_;
    std::int32_t currentHp_ = 0;

    TilePos tilePos_{};
    Vec2 worldPos_{};
    Facing facing_ = Facing::Right;

    bool moving_ = false;
    float moveStartTimeMs_ = 0.0f;
    Vec2 moveStartWorld_{};
    Vec2 moveTargetWorld_{};
    TilePos moveTargetTile_{};

    bool attacking_ = false;
    bool bigSkillCasting_ = false;
    bool attackUsesAutoLock_ = true;
    bool attackImpactResolved_ = false;
    bool attackImpactConsumed_ = false;
    std::int32_t attackDamageScalePercent_ = 100;
    std::int32_t attackVariant_ = 0;
    std::int32_t attackChainStep_ = 0;
    float attackStartTimeMs_ = 0.0f;
    bool hurt_ = false;
    bool dead_ = false;
    bool deathAnimationFinished_ = false;
    float hurtStartTimeMs_ = 0.0f;
    float deathStartTimeMs_ = 0.0f;

    std::optional<MoveRequest> pendingMove_;
    bool pendingAttack_ = false;
    bool pendingSmallSkill_ = false;
    bool pendingBigSkill_ = false;
    std::uint64_t pendingMoveSerial_ = 0;
    std::uint64_t pendingAttackSerial_ = 0;
    std::uint64_t pendingSmallSkillSerial_ = 0;
    std::uint64_t pendingBigSkillSerial_ = 0;
    std::uint64_t inputSerialCounter_ = 0;

    std::int32_t turnCounter_ = 0;
    std::int32_t smallSkillActiveUntilTurn_ = 0;
    std::int32_t smallSkillCooldownUntilTurn_ = 0;
    std::int32_t bigSkillCooldownUntilTurn_ = 0;

    bool archerSmallSkillAttack_ = false;
    bool archerBlessingActive_ = false;
    bool archerBlessingActivateOnNextTurn_ = false;
    bool archerVolleyPending_ = false;
    std::int32_t archerBlessingTurnsLeft_ = 0;

    BigWaveState bigWave_{};

    std::vector<TilePos> cachedSmallSkillTiles_;
};

} // namespace core
