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

Facing facingFromDirectionVector(TilePos direction) {
    if (direction.x < 0) return Facing::Left;
    if (direction.x > 0) return Facing::Right;
    if (direction.y < 0) return Facing::Up;
    if (direction.y > 0) return Facing::Down;
    return Facing::Right;
}

} // namespace

PlayerController::PlayerController(PlayerConfig config, CharacterRole role)
    : config_(config), role_(std::move(role)) {
    currentHp_ = role_.stats().maxHp;
}

void PlayerController::setSpawn(TilePos spawn) {
    tilePos_ = spawn;
    worldPos_ = tileToWorld(spawn);
    currentHp_ = role_.stats().maxHp;
    moving_ = false;
    attacking_ = false;
    bigSkillCasting_ = false;
    attackVariant_ = 0;
    attackChainStep_ = 0;
    attackStartTimeMs_ = 0.0f;
    attackImpactResolved_ = false;
    attackImpactConsumed_ = false;
    attackDamageScalePercent_ = 100;
    attackUsesAutoLock_ = true;
    hurt_ = false;
    dead_ = false;
    deathAnimationFinished_ = false;
    hurtStartTimeMs_ = 0.0f;
    deathStartTimeMs_ = 0.0f;

    clearPendingActions();

    turnCounter_ = 0;
    smallSkillActiveUntilTurn_ = 0;
    smallSkillCooldownUntilTurn_ = 0;
    bigSkillCooldownUntilTurn_ = 0;
    archerSmallSkillAttack_ = false;
    archerBlessingActive_ = false;
    archerBlessingActivateOnNextTurn_ = false;
    archerVolleyPending_ = false;
    archerBlessingTurnsLeft_ = 0;

    bigWave_ = BigWaveState{};
}

void PlayerController::requestMove(std::int32_t dx, std::int32_t dy,
    float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked,
    const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy) {
    if (dx == 0 && dy == 0) return;

    pendingMove_ = MoveRequest{dx, dy};
    pendingMoveSerial_ = ++inputSerialCounter_;
    (void)nowMs;
    (void)isBlocked;
    (void)hasEnemy;
}

void PlayerController::requestAttack(float nowMs) {
    if (dead_) return;
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

void PlayerController::applyDamage(std::int32_t damage, float nowMs) {
    if (dead_ || damage <= 0) return;

    currentHp_ = std::max(0, currentHp_ - damage);
    hurt_ = true;
    hurtStartTimeMs_ = nowMs;

    if (currentHp_ <= 0) {
        dead_ = true;
        deathAnimationFinished_ = false;
        deathStartTimeMs_ = nowMs;
        moving_ = false;
        attacking_ = false;
        bigSkillCasting_ = false;
        clearPendingActions();
    }
}

void PlayerController::revive(float nowMs) {
    currentHp_ = role_.stats().maxHp;
    hurt_ = false;
    dead_ = false;
    deathAnimationFinished_ = false;
    hurtStartTimeMs_ = nowMs;
    deathStartTimeMs_ = 0.0f;
    moving_ = false;
    attacking_ = false;
    bigSkillCasting_ = false;
    attackVariant_ = 0;
    attackChainStep_ = 0;
    attackStartTimeMs_ = 0.0f;
    attackImpactResolved_ = false;
    attackImpactConsumed_ = false;
    attackDamageScalePercent_ = 100;
    attackUsesAutoLock_ = true;
    archerSmallSkillAttack_ = false;
    archerVolleyPending_ = false;
    clearPendingActions();
}

void PlayerController::update(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked,
    const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy,
    bool allowActionStart) {
    if (hurt_ && (nowMs - hurtStartTimeMs_ >= config_.hurtDurationMs)) {
        hurt_ = false;
    }

    if (dead_) {
        moving_ = false;
        attacking_ = false;
        bigSkillCasting_ = false;
        if (!deathAnimationFinished_ && (nowMs - deathStartTimeMs_ >= config_.deathDurationMs)) {
            deathAnimationFinished_ = true;
        }
        return;
    }

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
        const float attackDuration = std::max(1.0f, config_.attackDurationMs);
        if (!attackImpactResolved_ && elapsedAttack >= attackDuration * 0.5f) {
            attackImpactResolved_ = true;
        }
        if (elapsedAttack >= config_.attackDurationMs) {
            finishAttack(nowMs, isBlocked);
        }
    }

    if (allowActionStart) {
        tryStartNextAction(nowMs, isBlocked, hasEnemy);
    }
}

bool PlayerController::isMoving() const {
    return moving_;
}

bool PlayerController::isAttacking() const {
    return attacking_ && !dead_;
}

bool PlayerController::isBigSkillCasting() const {
    return attacking_ && bigSkillCasting_ && !dead_;
}

bool PlayerController::isHurt() const {
    return hurt_;
}

bool PlayerController::isDead() const {
    return dead_;
}

bool PlayerController::deathAnimationFinished() const {
    return deathAnimationFinished_;
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

bool PlayerController::consumeAttackImpactReady() {
    if (!attacking_) return false;
    if (!attackImpactResolved_) return false;
    if (attackImpactConsumed_) return false;
    attackImpactConsumed_ = true;
    return true;
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
    if (dead_) return 0;
    return role_.stats().attackPower * attackDamageScalePercent_ / 100;
}

std::int32_t PlayerController::currentHp() const {
    return currentHp_;
}

bool PlayerController::isBigWaveActive() const {
    return bigWave_.active;
}

bool PlayerController::isArcherBlessingActive() const {
    return archerBlessingActive_;
}

bool PlayerController::consumeArcherVolleyReady() {
    if (!archerVolleyPending_) return false;
    archerVolleyPending_ = false;
    return true;
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

std::int32_t PlayerController::currentTurn() const {
    return turnCounter_;
}

std::vector<TilePos> PlayerController::attackAreaTiles() const {
    if (!attacking_) return {};

    if (role_.kind() == RoleKind::LegendaryLineArcher && archerSmallSkillAttack_) {
        return cachedSmallSkillTiles_;
    }

    if (isSmallSkillActive()) {
        return smallSkillAttackTiles();
    }

    if (role_.kind() == RoleKind::LegendaryLineArcher) {
        const TilePos dir = forwardVector(facing_);
        const std::int32_t range = std::max(1, role_.normalAttack().rangeTiles);
        std::vector<TilePos> tiles;
        tiles.reserve(static_cast<std::size_t>(range));
        for (std::int32_t distance = 1; distance <= range; ++distance) {
            tiles.push_back(TilePos{
                tilePos_.x + dir.x * distance,
                tilePos_.y + dir.y * distance
            });
        }
        return tiles;
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
    switch (facing) {
        case Facing::Left:  return {-1, 0};
        case Facing::Right: return { 1, 0};
        case Facing::Up:    return { 0,-1};
        case Facing::Down:  return { 0, 1};
        default:            return { 1, 0};
    }
}

TilePos PlayerController::leftVector(Facing facing) {
    switch (facing) {
        case Facing::Left:  return {0, 1};
        case Facing::Right: return {0, -1};
        case Facing::Up:    return {-1, 0};
        case Facing::Down:  return {1, 0};
        default:            return {0, 1};
    }
}

TilePos PlayerController::rightVector(Facing facing) {
    switch (facing) {
        case Facing::Left:  return {0, -1};
        case Facing::Right: return {0, 1};
        case Facing::Up:    return {1, 0};
        case Facing::Down:  return {-1, 0};
        default:            return {0, -1};
    }
}

TilePos PlayerController::backwardVector(Facing facing) {
    switch (facing) {
        case Facing::Left:  return { 1, 0};
        case Facing::Right: return {-1, 0};
        case Facing::Up:    return { 0, 1};
        case Facing::Down:  return { 0,-1};
        default:            return {-1, 0};
    }
}

std::vector<TilePos> PlayerController::smallSkillAttackTiles() const {
    const TilePos front = forwardVector(facing_);
    const TilePos left = leftVector(facing_);
    const TilePos right = rightVector(facing_);

    const TilePos front1 = addTile(tilePos_, front);
    const TilePos left1 = addTile(tilePos_, left);
    const TilePos right1 = addTile(tilePos_, right);

    const TilePos front2{tilePos_.x + front.x * 2, tilePos_.y + front.y * 2};
    const TilePos left2{tilePos_.x + left.x * 2, tilePos_.y + left.y * 2};
    const TilePos right2{tilePos_.x + right.x * 2, tilePos_.y + right.y * 2};
    const TilePos frontLeft1 = addTile(front1, left);
    const TilePos frontRight1 = addTile(front1, right);

    return {
        front1,
        left1,
        right1,
        frontLeft1,
        frontRight1,
        front2,
        left2,
        right2
    };
}

std::vector<TilePos> PlayerController::bigWaveCurrentTiles() const {
    const TilePos front = forwardVector(bigWave_.facing);
    const TilePos left = leftVector(bigWave_.facing);
    const TilePos right = rightVector(bigWave_.facing);

    const TilePos base = TilePos{
        bigWave_.originTile.x + front.x * bigWave_.frontDistance,
        bigWave_.originTile.y + front.y * bigWave_.frontDistance
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

    if (archerBlessingActivateOnNextTurn_) {
        archerBlessingActivateOnNextTurn_ = false;
        archerBlessingActive_ = true;
        archerBlessingTurnsLeft_ = 5;
        archerVolleyPending_ = false;
        return;
    }

    if (archerBlessingActive_) {
        if (archerBlessingTurnsLeft_ > 0) {
            archerVolleyPending_ = true;
            --archerBlessingTurnsLeft_;
        }
        if (archerBlessingTurnsLeft_ <= 0) {
            archerBlessingActive_ = false;
        }
    }
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
    if (dead_) return;

    if (slot == SkillSlot::Small) {
        pendingSmallSkill_ = true;
        pendingSmallSkillSerial_ = ++inputSerialCounter_;
        return;
    }

    pendingBigSkill_ = true;
    pendingBigSkillSerial_ = ++inputSerialCounter_;
}

void PlayerController::tryStartNextAction(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked,
    const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy){
    if (dead_ || moving_ || attacking_) return;

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
        startAttackAction(nowMs, hasEnemy);
        return;
    }

    if (pendingType == PendingActionType::SmallSkill) {
        pendingSmallSkill_ = false;
        startSmallSkillAction(nowMs, isBlocked, hasEnemy);
        return;
    }

    pendingBigSkill_ = false;
    startBigSkillAction(nowMs);
}

void PlayerController::startMoveAction(const MoveRequest& action, float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    if (dead_) return;
    
    if (action.dx < 0) facing_ = Facing::Left;
    else if (action.dx > 0) facing_ = Facing::Right;
    else if (action.dy < 0) facing_ = Facing::Up;
    else if (action.dy > 0) facing_ = Facing::Down;

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
}

void PlayerController::startAttackAction(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy) {
    if (dead_) return;

    // 普通攻击按前/左/右/后优先级在近战范围内寻敌，命中后立即转向。
    if (!isSmallSkillActive() && role_.normalAttack().autoLock) {
        const auto enemyInDirection = [&](Facing candidateFacing) {
            const TilePos dir = forwardVector(candidateFacing);
            const std::int32_t maxRange = std::max(1, role_.normalAttack().rangeTiles);
            for (std::int32_t distance = 1; distance <= maxRange; ++distance) {
                const TilePos target{
                    tilePos_.x + dir.x * distance,
                    tilePos_.y + dir.y * distance
                };
                if (hasEnemy(target.x, target.y)) {
                    facing_ = candidateFacing;
                    return true;
                }
            }
            return false;
        };

        for (const RelativeDirection relativeDirection : role_.normalAttack().targetPriority) {
            Facing candidateFacing = facing_;
            switch (relativeDirection) {
                case RelativeDirection::Front:
                    candidateFacing = facing_;
                    break;
                case RelativeDirection::Left:
                    candidateFacing = facingFromDirectionVector(leftVector(facing_));
                    break;
                case RelativeDirection::Right:
                    candidateFacing = facingFromDirectionVector(rightVector(facing_));
                    break;
                case RelativeDirection::Back:
                    candidateFacing = facingFromDirectionVector(backwardVector(facing_));
                    break;
                default:
                    break;
            }

            if (enemyInDirection(candidateFacing)) {
                break;
            }
        }
    }

    attacking_ = true;
    bigSkillCasting_ = false;
    attackStartTimeMs_ = nowMs;
    attackImpactResolved_ = false;
    attackImpactConsumed_ = false;

    if (isSmallSkillActive()) {
        attackVariant_ = 1;
        attackDamageScalePercent_ = 150;
        attackUsesAutoLock_ = false;
    } else if (role_.kind() == RoleKind::LegendaryLineArcher) {
        attackVariant_ = 3;
        attackDamageScalePercent_ = 100;
        attackUsesAutoLock_ = false;
    } else {
        attackVariant_ = (attackChainStep_ == 2) ? 2 : 1;
        attackChainStep_ = (attackChainStep_ + 1) % 3;
        attackDamageScalePercent_ = 100;
        attackUsesAutoLock_ = true;
    }
}

void PlayerController::startSmallSkillAction(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked,
    const std::function<bool(std::int32_t, std::int32_t)>& hasEnemy) {
    if (dead_) return;
    if (!smallSkillReady()) return;

    if (role_.kind() == RoleKind::LegendaryLineArcher) {
        // 技能冷却 5 回合
        smallSkillCooldownUntilTurn_ = turnCounter_ + 5;
        
        // 【核心修复】设置持续状态为 turnCounter_ + 2
        // 只有 +2 才能保证这个状态在调用 onTurnAdvanced() 后，依然能在当前的攻击动画期间存活！
        smallSkillActiveUntilTurn_ = turnCounter_ + 2;

        attacking_ = true;
        bigSkillCasting_ = false;
        attackStartTimeMs_ = nowMs;
        attackImpactResolved_ = false;
        attackImpactConsumed_ = false;
        attackVariant_ = 3;  // 播放射箭动作
        attackDamageScalePercent_ = 100; // 散弹视作平A伤害
        attackUsesAutoLock_ = false;
        archerSmallSkillAttack_ = true;

        cachedSmallSkillTiles_.clear();
        TilePos current = tilePos_;
        Facing currentFacing = facing_;
        int bounces = 0;
        bool hitEnemy = false;
        TilePos enemyPos{};

        // 1. 计算最多 15 格的反弹路径
        for (int step = 1; step <= 15; ++step) {
            TilePos next = addTile(current, forwardVector(currentFacing));

            if (isBlocked(next.x, next.y)) {
                if (bounces >= 2) break; // 最多反转两次
                bounces++;

                TilePos leftDir = leftVector(currentFacing);
                TilePos rightDir = rightVector(currentFacing);
                TilePos leftTile = addTile(current, leftDir);
                TilePos rightTile = addTile(current, rightDir);

                bool leftBlocked = isBlocked(leftTile.x, leftTile.y);
                bool rightBlocked = isBlocked(rightTile.x, rightTile.y);

                // 转向逻辑
                if (leftBlocked && !rightBlocked) {
                    currentFacing = facingFromDirectionVector(rightDir);
                } else if (rightBlocked && !leftBlocked) {
                    currentFacing = facingFromDirectionVector(leftDir);
                } else {
                    currentFacing = facingFromDirectionVector(backwardVector(currentFacing)); // 掉头
                }
                
                next = addTile(current, forwardVector(currentFacing));
                if (isBlocked(next.x, next.y)) break; // 转向后还是墙则停止
            }

            current = next;
            cachedSmallSkillTiles_.push_back(current);

            // 检测命中
            if (hasEnemy(current.x, current.y)) {
                hitEnemy = true;
                enemyPos = current;
                break;
            }
        }

        // 2. 命中后生成 8 向散弹扩散
        if (hitEnemy) {
            int dx[] = {-1, 1, 0, 0, -1, 1, -1, 1};
            int dy[] = {0, 0, -1, 1, -1, -1, 1, 1};
            const std::int32_t range = std::max<std::int32_t>(1, role_.normalAttack().rangeTiles);
            for (int d = 0; d < 8; ++d) {
                int sx = dx[d];
                int sy = dy[d];
                bool turned = false;
                TilePos origin = enemyPos;
                TilePos current = origin;
                for (int travelled = 0; travelled < range; ++travelled) {
                    TilePos next{current.x + sx, current.y + sy};

                    if (isBlocked(next.x, next.y)) {
                        if (!archerBlessingActive_ || turned) {
                            break;
                        }

                        if (sx != 0 && sy != 0) {
                            const bool blockX = isBlocked(current.x + sx, current.y);
                            const bool blockY = isBlocked(current.x, current.y + sy);
                            if (blockX && blockY) {
                                sx = -sx;
                                sy = -sy;
                            } else if (blockX && !blockY) {
                                sx = -sx;
                            } else if (!blockX && blockY) {
                                sy = -sy;
                            } else {
                                sx = -sx;
                                sy = -sy;
                            }
                        } else {
                            sx = -sx;
                            sy = -sy;
                        }

                        turned = true;
                        next = TilePos{current.x + sx, current.y + sy};
                        if (isBlocked(next.x, next.y)) {
                            break;
                        }
                    }

                    current = next;
                    cachedSmallSkillTiles_.push_back(current);

                    // 扩散箭视作普通攻击：命中该方向首个敌人后停止继续穿透。
                    if (hasEnemy(current.x, current.y)) {
                        break;
                    }
                }
            }
        }

        // 【非常重要】推动回合引擎，结算伤害并让怪物能做出反击
        onTurnAdvanced();
    } else {
        // 原版战士的技能逻辑保持不变
        smallSkillCooldownUntilTurn_ = turnCounter_ + 17;
        smallSkillActiveUntilTurn_ = turnCounter_ + 11;
        attackDamageScalePercent_ = 150;
        attackUsesAutoLock_ = false;
        onTurnAdvanced();
    }
}

void PlayerController::startBigSkillAction(float nowMs) {
    if (dead_) return;
    if (!bigSkillReady()) {
        return;
    }

    if (role_.kind() == RoleKind::LegendaryLineArcher) {
        bigSkillCooldownUntilTurn_ = turnCounter_ + 12;
        attacking_ = true;
        bigSkillCasting_ = true;
        attackStartTimeMs_ = nowMs;
        attackImpactResolved_ = false;
        attackImpactConsumed_ = false;
        attackVariant_ = 3;
        attackDamageScalePercent_ = 100;
        attackUsesAutoLock_ = false;

        archerBlessingActivateOnNextTurn_ = true;
        archerVolleyPending_ = false;
        return;
    }

    bigSkillCooldownUntilTurn_ = turnCounter_ + 13;

    bigWave_.active = true;
    bigWave_.originTile = tilePos_;
    bigWave_.facing = facing_;
    // 从角色脚下开始生成剑气，后续按回合向前推进。
    bigWave_.frontDistance = 0;

    attacking_ = true;
    bigSkillCasting_ = true;
    attackStartTimeMs_ = nowMs;
    attackImpactResolved_ = false;
    attackImpactConsumed_ = false;
    attackVariant_ = 2;
    attackDamageScalePercent_ = 300;
    attackUsesAutoLock_ = false;
}

void PlayerController::finishAttack(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    attacking_ = false;
    attackVariant_ = 0;
    bigSkillCasting_ = false;
    archerSmallSkillAttack_ = false;

    if (isSmallSkillActive()) {
        attackDamageScalePercent_ = 150;
        attackUsesAutoLock_ = false;
    } else if (role_.kind() == RoleKind::LegendaryLineArcher) {
        attackDamageScalePercent_ = 100;
        attackUsesAutoLock_ = false;
    } else {
        attackDamageScalePercent_ = 100;
        attackUsesAutoLock_ = true;
    }

    (void)nowMs;
    (void)isBlocked;
    onTurnAdvanced();
}

void PlayerController::clearPendingActions() {
    pendingMove_.reset();
    pendingAttack_ = false;
    pendingSmallSkill_ = false;
    pendingBigSkill_ = false;
    pendingMoveSerial_ = 0;
    pendingAttackSerial_ = 0;
    pendingSmallSkillSerial_ = 0;
    pendingBigSkillSerial_ = 0;
    inputSerialCounter_ = 0;
}

void PlayerController::finishMove(float nowMs,
    const std::function<bool(std::int32_t, std::int32_t)>& isBlocked) {
    tilePos_ = moveTargetTile_;
    worldPos_ = moveTargetWorld_;
    moving_ = false;
    (void)nowMs;
    (void)isBlocked;
    onTurnAdvanced();
}

} // namespace core
