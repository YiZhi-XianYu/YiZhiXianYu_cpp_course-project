#include "core/PlayerController.hpp"

#include <algorithm>
#include <cmath>
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

TilePos addTile(TilePos a, TilePos b) {
    return TilePos{a.x + b.x, a.y + b.y};
}

} // namespace

PlayerController::PlayerController(PlayerConfig config, CharacterRole role)
    : config_(config), role_(std::move(role)) {
}

void PlayerController::setSpawn(TilePos spawn) {
    tilePos_ = spawn;
    worldPos_ = tileToWorld(spawn);
    moving_ = false;
    attacking_ = false;
    bigSkillCasting_ = false;
    attackVariant_ = 0;
    attackChainStep_ = 0;
    attackStartTimeMs_ = 0.0f;
    attackDamageScalePercent_ = 100;
    attackUsesAutoLock_ = true;

    pendingMove_.reset();
    pendingAttack_ = false;
    pendingSmallSkill_ = false;
    pendingBigSkill_ = false;
    pendingMoveSerial_ = 0;
    pendingAttackSerial_ = 0;
    pendingSmallSkillSerial_ = 0;
    pendingBigSkillSerial_ = 0;
    inputSerialCounter_ = 0;

    turnCounter_ = 0;
    smallSkillActiveUntilTurn_ = 0;
    smallSkillCooldownUntilTurn_ = 0;
    bigSkillCooldownUntilTurn_ = 0;

    bigWave_ = BigWaveState{};
}

void PlayerController::requestMove(std::int32_t dx, std::int32_t dy,
    float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    if (dx == 0 && dy == 0) return;

    pendingMove_ = MoveRequest{dx, dy};
    pendingMoveSerial_ = ++inputSerialCounter_;
    tryStartNextAction(nowMs, isBlocked);
}

void PlayerController::requestAttack(float nowMs) {
    pendingAttack_ = true;
    pendingAttackSerial_ = ++inputSerialCounter_;
    (void)nowMs;
}

void PlayerController::requestSmallSkill(float nowMs) {
    requestSkill(SkillSlot::Small, nowMs);
}

void PlayerController::requestBigSkill(float nowMs) {
    requestSkill(SkillSlot::Big, nowMs);
}

void PlayerController::update(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    if (moving_) {
        const float elapsed = nowMs - moveStartTimeMs_;
        const float progress = clamp01(elapsed / config_.moveDurationMs);
        const float eased = easeInOutQuad(progress);

        worldPos_.x = lerp(moveStartWorld_.x, moveTargetWorld_.x, eased);
        worldPos_.y = lerp(moveStartWorld_.y, moveTargetWorld_.y, eased);

        if (progress >= 1.0f) {
            finishMove(nowMs, isBlocked);
        }
    }

    if (attacking_) {
        const float elapsedAttack = nowMs - attackStartTimeMs_;
        if (elapsedAttack >= config_.attackDurationMs) {
            finishAttack(nowMs, isBlocked);
        }
    }

    tryStartNextAction(nowMs, isBlocked);
}

bool PlayerController::isMoving() const {
    return moving_;
}

bool PlayerController::isAttacking() const {
    return attacking_;
}

Facing PlayerController::facing() const {
    return facing_;
}

bool PlayerController::isWalkingAnimation() const {
    return moving_;
}

std::int32_t PlayerController::attackVariant() const {
    return attacking_ ? attackVariant_ : 0;
}

std::int32_t PlayerController::attackDamageScalePercent() const {
    return attackDamageScalePercent_;
}

bool PlayerController::attackUsesAutoLock() const {
    return attackUsesAutoLock_;
}

bool PlayerController::isSmallSkillActive() const {
    return turnCounter_ < smallSkillActiveUntilTurn_;
}

std::int32_t PlayerController::smallSkillTurnsLeft() const {
    if (!isSmallSkillActive()) return 0;
    return smallSkillActiveUntilTurn_ - turnCounter_;
}

std::int32_t PlayerController::smallSkillCooldownTurnsLeft() const {
    if (turnCounter_ >= smallSkillCooldownUntilTurn_) return 0;
    return smallSkillCooldownUntilTurn_ - turnCounter_;
}

std::int32_t PlayerController::bigSkillCooldownTurnsLeft() const {
    if (turnCounter_ >= bigSkillCooldownUntilTurn_) return 0;
    return bigSkillCooldownUntilTurn_ - turnCounter_;
}

std::int32_t PlayerController::currentAttackPower() const {
    return role_.stats().attackPower * attackDamageScalePercent_ / 100;
}

bool PlayerController::isBigWaveActive() const {
    return bigWave_.active;
}

TilePos PlayerController::bigWaveOriginTile() const {
    return bigWave_.originTile;
}

std::int32_t PlayerController::bigWaveFrontDistance() const {
    return bigWave_.frontDistance;
}

Facing PlayerController::bigWaveFacing() const {
    return bigWave_.facing;
}

std::vector<TilePos> PlayerController::attackAreaTiles() const {
    if (!attacking_) return {};

    if (isSmallSkillActive()) {
        return smallSkillAttackTiles();
    }

    const TilePos front = addTile(tilePos_, forwardVector(facing_));
    return {front};
}

std::vector<TilePos> PlayerController::bigWaveTiles() const {
    if (!bigWave_.active) return {};
    return bigWaveCurrentTiles();
}

const CharacterRole& PlayerController::role() const {
    return role_;
}

TilePos PlayerController::tilePos() const {
    return tilePos_;
}

Vec2 PlayerController::worldPos() const {
    return worldPos_;
}

TilePos PlayerController::forwardVector(Facing facing) {
    return facing == Facing::Left ? TilePos{-1, 0} : TilePos{1, 0};
}

TilePos PlayerController::leftVector(Facing facing) {
    return facing == Facing::Left ? TilePos{0, 1} : TilePos{0, -1};
}

TilePos PlayerController::rightVector(Facing facing) {
    return facing == Facing::Left ? TilePos{0, -1} : TilePos{0, 1};
}

std::vector<TilePos> PlayerController::smallSkillAttackTiles() const {
    const TilePos front = forwardVector(facing_);
    const TilePos left = leftVector(facing_);
    const TilePos right = rightVector(facing_);
    const TilePos skillCenter = TilePos{tilePos_.x, tilePos_.y - 2};
    const TilePos frontCenter = addTile(skillCenter, front);
    return {
        frontCenter,
        addTile(skillCenter, left),
        addTile(skillCenter, right),
        addTile(frontCenter, left),
        addTile(frontCenter, right)
    };
}

std::vector<TilePos> PlayerController::bigWaveCurrentTiles() const {
    const TilePos front = forwardVector(bigWave_.facing);
    const TilePos left = leftVector(bigWave_.facing);
    const TilePos right = rightVector(bigWave_.facing);

    const TilePos base = TilePos{
        bigWave_.originTile.x + front.x * bigWave_.frontDistance,
        bigWave_.originTile.y + front.y * bigWave_.frontDistance - 2
    };

    const TilePos frontOfBase = addTile(base, front);
    return {
        base,
        addTile(base, left),
        addTile(base, right),
        frontOfBase
    };
}

Vec2 PlayerController::tileToWorld(TilePos tilePos) const {
    return {
        (static_cast<float>(tilePos.x) + 0.5f) * config_.tileWidth * config_.worldScale,
        ((static_cast<float>(tilePos.y) + 1.0f) * config_.tileHeight - config_.feetOffsetY) * config_.worldScale
    };
}

void PlayerController::resetAttackChain() {
    attackChainStep_ = 0;
}

void PlayerController::onTurnAdvanced() {
    ++turnCounter_;
    updateBigWavePerTurn();
}

void PlayerController::updateBigWavePerTurn() {
    if (!bigWave_.active) return;

    if (bigWave_.frontDistance >= 10) {
        bigWave_.active = false;
        return;
    }

    bigWave_.frontDistance = std::min(10, bigWave_.frontDistance + 2);
}

bool PlayerController::smallSkillReady() const {
    return turnCounter_ >= smallSkillCooldownUntilTurn_;
}

bool PlayerController::bigSkillReady() const {
    return turnCounter_ >= bigSkillCooldownUntilTurn_;
}

void PlayerController::requestSkill(SkillSlot slot, float nowMs) {
    (void)nowMs;

    if (slot == SkillSlot::Small) {
        pendingSmallSkill_ = true;
        pendingSmallSkillSerial_ = ++inputSerialCounter_;
        return;
    }

    pendingBigSkill_ = true;
    pendingBigSkillSerial_ = ++inputSerialCounter_;
}

void PlayerController::tryStartNextAction(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    if (moving_ || attacking_) return;

    const bool hasMove = pendingMove_.has_value();
    const bool hasAttack = pendingAttack_;
    const bool hasSmallSkill = pendingSmallSkill_;
    const bool hasBigSkill = pendingBigSkill_;

    if (!hasMove && !hasAttack && !hasSmallSkill && !hasBigSkill) return;

    std::uint64_t latestSerial = 0;
    enum class PendingActionType {
        None,
        Move,
        Attack,
        SmallSkill,
        BigSkill
    };

    PendingActionType pendingType = PendingActionType::None;

    if (hasMove && pendingMoveSerial_ >= latestSerial) {
        latestSerial = pendingMoveSerial_;
        pendingType = PendingActionType::Move;
    }
    if (hasAttack && pendingAttackSerial_ >= latestSerial) {
        latestSerial = pendingAttackSerial_;
        pendingType = PendingActionType::Attack;
    }
    if (hasSmallSkill && pendingSmallSkillSerial_ >= latestSerial) {
        latestSerial = pendingSmallSkillSerial_;
        pendingType = PendingActionType::SmallSkill;
    }
    if (hasBigSkill && pendingBigSkillSerial_ >= latestSerial) {
        pendingType = PendingActionType::BigSkill;
    }

    if (pendingType == PendingActionType::Move) {
        const MoveRequest action = pendingMove_.value();
        pendingMove_.reset();
        startMoveAction(action, nowMs, isBlocked);
        return;
    }

    if (pendingType == PendingActionType::Attack) {
        pendingAttack_ = false;
        startAttackAction(nowMs);
        return;
    }

    if (pendingType == PendingActionType::SmallSkill) {
        pendingSmallSkill_ = false;
        startSmallSkillAction(nowMs);
        return;
    }

    pendingBigSkill_ = false;
    startBigSkillAction(nowMs);
}

void PlayerController::startMoveAction(const MoveRequest& action, float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    if (action.dx < 0) facing_ = Facing::Left;
    if (action.dx > 0) facing_ = Facing::Right;

    resetAttackChain();

    const TilePos next{tilePos_.x + action.dx, tilePos_.y + action.dy};
    if (isBlocked(next.x, next.y)) {
        return;
    }

    moving_ = true;
    moveStartTimeMs_ = nowMs;
    moveStartWorld_ = worldPos_;
    moveTargetWorld_ = tileToWorld(next);
    moveTargetTile_ = next;

    onTurnAdvanced();
}

void PlayerController::startAttackAction(float nowMs) {
    attacking_ = true;
    bigSkillCasting_ = false;
    attackStartTimeMs_ = nowMs;

    if (isSmallSkillActive()) {
        attackVariant_ = 1;
        attackDamageScalePercent_ = 150;
        attackUsesAutoLock_ = false;
    } else {
        attackVariant_ = (attackChainStep_ == 2) ? 2 : 1;
        attackChainStep_ = (attackChainStep_ + 1) % 3;
        attackDamageScalePercent_ = 100;
        attackUsesAutoLock_ = true;
    }

    onTurnAdvanced();
}

void PlayerController::startSmallSkillAction(float nowMs) {
    (void)nowMs;

    if (!smallSkillReady()) {
        return;
    }

    smallSkillCooldownUntilTurn_ = turnCounter_ + 17;
    smallSkillActiveUntilTurn_ = turnCounter_ + 11;
    attackDamageScalePercent_ = 150;
    attackUsesAutoLock_ = false;

    onTurnAdvanced();
}

void PlayerController::startBigSkillAction(float nowMs) {
    if (!bigSkillReady()) {
        return;
    }

    bigSkillCooldownUntilTurn_ = turnCounter_ + 13;

    bigWave_.active = true;
    bigWave_.originTile = tilePos_;
    bigWave_.facing = facing_;
    bigWave_.frontDistance = -2;

    attacking_ = true;
    bigSkillCasting_ = true;
    attackStartTimeMs_ = nowMs;
    attackVariant_ = 2;
    attackDamageScalePercent_ = 300;
    attackUsesAutoLock_ = false;

    onTurnAdvanced();
}

void PlayerController::finishAttack(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    attacking_ = false;
    attackVariant_ = 0;
    bigSkillCasting_ = false;

    if (isSmallSkillActive()) {
        attackDamageScalePercent_ = 150;
        attackUsesAutoLock_ = false;
    } else {
        attackDamageScalePercent_ = 100;
        attackUsesAutoLock_ = true;
    }

    (void)nowMs;
    (void)isBlocked;
}

void PlayerController::finishMove(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    tilePos_ = moveTargetTile_;
    worldPos_ = moveTargetWorld_;
    moving_ = false;
    (void)nowMs;
    (void)isBlocked;
}

} // namespace core
