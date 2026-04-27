#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <memory>
#include <vector>

#include "core/CameraController.hpp"
#include "core/MonsterController.hpp"
#include "core/PlayerController.hpp"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define GC_KEEPALIVE EMSCRIPTEN_KEEPALIVE
#else
#define GC_KEEPALIVE
#endif

namespace {

using core::CameraBounds;
using core::CameraConfig;
using core::CameraController;
using core::CharacterRole;
using core::Facing;
using core::MonsterConfig;
using core::MonsterController;
using core::PlayerConfig;
using core::PlayerController;
using core::RoleKind;
using core::TilePos;

std::unique_ptr<PlayerController> g_player;
std::vector<std::unique_ptr<MonsterController>> g_enemies;
std::unique_ptr<CameraController> g_camera;
PlayerConfig g_playerConfig{};
MonsterConfig g_monsterConfig{};
CameraConfig g_cameraConfig{};
bool g_playerSpawned = false;
std::int32_t g_enemyTurnCursor = 0;
std::int32_t g_lastProcessedTurn = -1;
bool g_prevPlayerAttacking = false;
bool g_prevBigWaveActive = false;
std::int32_t g_prevBigWaveFrontDistance = -999;
std::vector<std::uint8_t> g_bigWaveHitEnemyFlags;
std::int32_t g_bigWaveDamageSnapshot = 0;

enum class PlayerCommandType {
    Move,
    Attack,
    SmallSkill,
    BigSkill
};

struct PlayerCommand {
    PlayerCommandType type = PlayerCommandType::Move;
    std::int32_t dx = 0;
    std::int32_t dy = 0;
    float nowMs = 0.0f;
};

std::deque<PlayerCommand> g_playerCommandQueue;

std::vector<std::uint8_t> g_baseSolidGrid;
std::int32_t g_mapWidth = 0;
std::int32_t g_mapHeight = 0;
std::int32_t g_collisionYOffset = -2;

float g_worldWidth = 0.0f;
float g_worldHeight = 0.0f;
float g_viewportWidth = 0.0f;
float g_viewportHeight = 0.0f;

CharacterRole roleFromKindInt(std::int32_t roleKind) {
    if (roleKind == 0) {
        return CharacterRole::plainPhysicalMage();
    }
    return CharacterRole::legendaryLineArcher();
}

void resetCombatRuntimeState() {
    g_lastProcessedTurn = -1;
    g_enemyTurnCursor = 0;
    g_prevPlayerAttacking = false;
    g_prevBigWaveActive = false;
    g_prevBigWaveFrontDistance = -999;
    g_bigWaveHitEnemyFlags.clear();
    g_bigWaveDamageSnapshot = 0;
    g_playerSpawned = false;
    g_playerCommandQueue.clear();
}

void ensureEnemiesSize(std::size_t count) {
    while (g_enemies.size() < count) {
        g_enemies.push_back(std::make_unique<MonsterController>(g_monsterConfig));
    }
    if (g_bigWaveHitEnemyFlags.size() < g_enemies.size()) {
        g_bigWaveHitEnemyFlags.resize(g_enemies.size(), 0);
    }
}

void ensureControllersInitialized() {
    if (!g_player) {
        g_player = std::make_unique<PlayerController>(g_playerConfig, CharacterRole::legendaryLineArcher());
        resetCombatRuntimeState();
    }
    if (g_enemies.empty()) {
        ensureEnemiesSize(1);
    }
    if (!g_camera) {
        g_camera = std::make_unique<CameraController>(g_cameraConfig);
    }
}

CameraBounds bounds() {
    CameraBounds b{};
    b.worldWidth = g_worldWidth;
    b.worldHeight = g_worldHeight;
    b.viewportWidth = g_viewportWidth;
    b.viewportHeight = g_viewportHeight;
    return b;
}

bool isSolidBase(std::int32_t x, std::int32_t y) {
    if (x < 0 || y < 0 || x >= g_mapWidth || y >= g_mapHeight) return true;
    const std::int32_t index = y * g_mapWidth + x;
    if (index < 0 || index >= static_cast<std::int32_t>(g_baseSolidGrid.size())) return true;
    return g_baseSolidGrid[static_cast<std::size_t>(index)] != 0;
}

bool isBlocked(std::int32_t x, std::int32_t y) {
    return isSolidBase(x, y + g_collisionYOffset);
}

bool hasEnemyAt(std::int32_t x, std::int32_t y) {
    return std::any_of(g_enemies.begin(), g_enemies.end(), [x, y](const std::unique_ptr<MonsterController>& enemy) {
        if (!enemy || enemy->isRemoved()) return false;
        const TilePos pos = enemy->tilePos();
        return pos.x == x && pos.y == y;
    });
}

bool isBlockedForPlayer(std::int32_t x, std::int32_t y) {
    if (isBlocked(x, y)) return true;
    return hasEnemyAt(x, y);
}

bool isBlockedForEnemy(std::int32_t x, std::int32_t y, TilePos playerTile, std::int32_t selfIndex) {
    if (isBlocked(x, y)) return true;
    if (x == playerTile.x && y == playerTile.y) return true;

    for (std::size_t i = 0; i < g_enemies.size(); ++i) {
        if (static_cast<std::int32_t>(i) == selfIndex) continue;
        const auto& enemy = g_enemies[i];
        if (!enemy || enemy->isRemoved()) continue;
        const TilePos pos = enemy->tilePos();
        if (pos.x == x && pos.y == y) return true;
    }

    return false;
}

bool tileInArea(const std::vector<TilePos>& tiles, TilePos tile) {
    return std::any_of(tiles.begin(), tiles.end(), [tile](const TilePos& areaTile) {
        return areaTile.x == tile.x && areaTile.y == tile.y;
    });
}

MonsterController* findAliveEnemyAt(std::int32_t x, std::int32_t y) {
    for (auto& enemy : g_enemies) {
        if (!enemy || enemy->isRemoved() || enemy->isDead()) continue;
        const TilePos pos = enemy->tilePos();
        if (pos.x == x && pos.y == y) {
            return enemy.get();
        }
    }
    return nullptr;
}

void resolveArcherArrowTrace(
    TilePos origin,
    TilePos direction,
    std::int32_t maxRange,
    bool allowOneTurn,
    float nowMs,
    TilePos damageSource
) {
    if (!g_player) return;
    if (maxRange <= 0) return;
    if (direction.x == 0 && direction.y == 0) return;

    TilePos current = origin;
    TilePos dir = direction;
    bool turned = false;

    for (std::int32_t travelled = 0; travelled < maxRange; ++travelled) {
        TilePos next{current.x + dir.x, current.y + dir.y};

        if (isBlocked(next.x, next.y)) {
            if (!allowOneTurn || turned) {
                break;
            }

            if (dir.x != 0 && dir.y != 0) {
                const bool blockX = isBlocked(current.x + dir.x, current.y);
                const bool blockY = isBlocked(current.x, current.y + dir.y);
                if (blockX && blockY) {
                    dir.x = -dir.x;
                    dir.y = -dir.y;
                } else if (blockX && !blockY) {
                    dir.x = -dir.x;
                } else if (!blockX && blockY) {
                    dir.y = -dir.y;
                } else {
                    dir.x = -dir.x;
                    dir.y = -dir.y;
                }
            } else {
                dir.x = -dir.x;
                dir.y = -dir.y;
            }

            turned = true;
            next = TilePos{current.x + dir.x, current.y + dir.y};
            if (isBlocked(next.x, next.y)) {
                break;
            }
        }

        current = next;

        MonsterController* enemy = findAliveEnemyAt(current.x, current.y);
        if (enemy) {
            enemy->applyDamage(g_player->currentAttackPower(), nowMs, damageSource);
            break;
        }
    }
}

void resolveArcherBlessingVolley(float nowMs) {
    if (!g_player) return;
    if (!g_player->consumeArcherVolleyReady()) return;
    if (g_player->isDead()) return;

    const TilePos origin = g_player->tilePos();
    const std::int32_t range = std::max(1, g_player->role().normalAttack().rangeTiles);
    const bool allowTurn = g_player->isArcherBlessingActive();

    const TilePos dirs[] = {
        {-1, 0}, {1, 0}, {0, -1}, {0, 1},
        {-1, -1}, {1, -1}, {-1, 1}, {1, 1}
    };

    for (const TilePos& dir : dirs) {
        resolveArcherArrowTrace(origin, dir, range, allowTurn, nowMs, origin);
    }
}

TilePos forwardVectorForFacing(Facing facing) {
    switch (facing) {
        case Facing::Left:  return {-1, 0};
        case Facing::Right: return { 1, 0};
        case Facing::Up:    return { 0,-1};
        case Facing::Down:  return { 0, 1};
        default:            return { 1, 0};
    }
}

TilePos leftVectorForFacing(Facing facing) {
    switch (facing) {
        case Facing::Left:  return {0, 1};
        case Facing::Right: return {0, -1};
        case Facing::Up:    return {-1, 0};
        case Facing::Down:  return {1, 0};
        default:            return {0, 1};
    }
}

TilePos rightVectorForFacing(Facing facing) {
    switch (facing) {
        case Facing::Left:  return {0, -1};
        case Facing::Right: return {0, 1};
        case Facing::Up:    return {1, 0};
        case Facing::Down:  return {-1, 0};
        default:            return {0, -1};
    }
}

std::vector<TilePos> bigWaveTilesAtDistance(const PlayerController& player, std::int32_t frontDistance) {
    const TilePos origin = player.bigWaveOriginTile();
    const Facing facing = player.bigWaveFacing();
    const TilePos front = forwardVectorForFacing(facing);
    const TilePos left = leftVectorForFacing(facing);
    const TilePos right = rightVectorForFacing(facing);

    const TilePos base{
        origin.x + front.x * frontDistance,
        origin.y + front.y * frontDistance
    };

    const TilePos frontOfBase{base.x + front.x, base.y + front.y};
    return {
        base,
        TilePos{base.x + left.x, base.y + left.y},
        TilePos{base.x + right.x, base.y + right.y},
        frontOfBase
    };
}

void appendUniqueTiles(std::vector<TilePos>& outTiles, const std::vector<TilePos>& inTiles) {
    for (const TilePos& tile : inTiles) {
        const bool exists = std::any_of(outTiles.begin(), outTiles.end(), [&tile](const TilePos& t) {
            return t.x == tile.x && t.y == tile.y;
        });
        if (!exists) {
            outTiles.push_back(tile);
        }
    }
}

bool isEnemyAnimating() {
    return std::any_of(g_enemies.begin(), g_enemies.end(), [](const std::unique_ptr<MonsterController>& enemy) {
        if (!enemy || enemy->isRemoved()) return false;
        return enemy->isAttacking() || enemy->isWalkingAnimation();
    });
}

MonsterController* enemyAtIndex(std::int32_t index) {
    if (index < 0) return nullptr;
    if (index >= static_cast<std::int32_t>(g_enemies.size())) return nullptr;
    return g_enemies[static_cast<std::size_t>(index)].get();
}

const MonsterController* legacyEnemy() {
    for (const auto& enemy : g_enemies) {
        if (!enemy) continue;
        if (enemy->isRemoved()) continue;
        return enemy.get();
    }
    return nullptr;
}

void tryDispatchNextPlayerCommand(float nowMs) {
    if (!g_player || g_player->isDead()) return;
    if (g_playerCommandQueue.empty()) return;
    if (g_player->isMoving() || g_player->isAttacking()) return;
    if (isEnemyAnimating()) return;

    const PlayerCommand command = g_playerCommandQueue.front();
    g_playerCommandQueue.pop_front();

    switch (command.type) {
        case PlayerCommandType::Move:
            g_player->requestMove(command.dx, command.dy, command.nowMs, isBlockedForPlayer, hasEnemyAt);
            break;
        case PlayerCommandType::Attack:
            g_player->requestAttack(command.nowMs);
            break;
        case PlayerCommandType::SmallSkill:
            g_player->requestSmallSkill(command.nowMs);
            break;
        case PlayerCommandType::BigSkill:
            g_player->requestBigSkill(command.nowMs);
            break;
        default:
            break;
    }

    // 立即尝试开行动，保证按键后在可行动帧及时生效。
    g_player->update(nowMs, isBlockedForPlayer, hasEnemyAt, true);
}

void resolvePlayerAttack(float nowMs) {
    if (!g_player) return;
    if (g_player->isDead()) return;
    if (!g_player->consumeAttackImpactReady()) return;
    if (g_player->isBigSkillCasting()) return;

    const auto attackTiles = g_player->attackAreaTiles();
    if (attackTiles.empty()) return;

    if (g_player->role().kind() == RoleKind::LegendaryLineArcher) {
        // 小技能命中区域已在控制器中计算完成，按区域直接结算，不做“首目标中断”。
        if (g_player->isSmallSkillActive()) {
            for (const auto& enemy : g_enemies) {
                if (!enemy || enemy->isRemoved() || enemy->isDead()) continue;
                if (tileInArea(attackTiles, enemy->tilePos())) {
                    enemy->applyDamage(g_player->currentAttackPower(), nowMs, g_player->tilePos());
                }
            }
            return;
        }

        const TilePos origin = g_player->tilePos();
        TilePos direction{0, 0};
        if (!attackTiles.empty()) {
            direction.x = attackTiles.front().x - origin.x;
            direction.y = attackTiles.front().y - origin.y;
            direction.x = (direction.x < 0) ? -1 : (direction.x > 0 ? 1 : 0);
            direction.y = (direction.y < 0) ? -1 : (direction.y > 0 ? 1 : 0);
        }

        const std::int32_t range = std::max(1, g_player->role().normalAttack().rangeTiles);
        const bool allowTurn = g_player->isArcherBlessingActive();
        resolveArcherArrowTrace(origin, direction, range, allowTurn, nowMs, origin);
        return;
    }

    for (const auto& enemy : g_enemies) {
        if (!enemy || enemy->isRemoved() || enemy->isDead()) continue;
        if (tileInArea(attackTiles, enemy->tilePos())) {
            enemy->applyDamage(g_player->currentAttackPower(), nowMs, g_player->tilePos());
        }
    }
}

void resolvePlayerBigWaveDamage(float nowMs) {
    if (!g_player) return;

    const bool waveActive = g_player->isBigWaveActive();
    if (!waveActive) {
        g_prevBigWaveActive = false;
        g_prevBigWaveFrontDistance = -999;
        g_bigWaveHitEnemyFlags.assign(g_enemies.size(), 0);
        g_bigWaveDamageSnapshot = 0;
        return;
    }

    const std::int32_t currentFrontDistance = g_player->bigWaveFrontDistance();
    std::int32_t previousFrontDistance = g_prevBigWaveFrontDistance;

    if (!g_prevBigWaveActive) {
        // 新剑气刚释放瞬间不伤害，从 frontDistance=0 开始记录。
        g_prevBigWaveActive = true;
        g_bigWaveHitEnemyFlags.assign(g_enemies.size(), 0);
        g_bigWaveDamageSnapshot = std::max(1, g_player->currentAttackPower());
        previousFrontDistance = 0;

        if (currentFrontDistance == 0) {
            g_prevBigWaveFrontDistance = currentFrontDistance;
            return;
        }
    }

    // 剑气固定在回合末推进：仅在 frontDistance 变化时结算。
    if (currentFrontDistance == previousFrontDistance) {
        return;
    }

    g_prevBigWaveFrontDistance = currentFrontDistance;
    if (g_player->isDead()) return;

    // 结算“经过地面 + 推进后地面”：将区间内每一步四格并集作为命中区域。
    std::vector<TilePos> impactedTiles;
    const std::int32_t step = (currentFrontDistance >= previousFrontDistance) ? 1 : -1;
    for (std::int32_t distance = previousFrontDistance;; distance += step) {
        appendUniqueTiles(impactedTiles, bigWaveTilesAtDistance(*g_player, distance));
        if (distance == currentFrontDistance) {
            break;
        }
    }

    const std::int32_t damage = std::max(1, g_bigWaveDamageSnapshot);
    if (g_bigWaveHitEnemyFlags.size() < g_enemies.size()) {
        g_bigWaveHitEnemyFlags.resize(g_enemies.size(), 0);
    }

    for (std::size_t i = 0; i < g_enemies.size(); ++i) {
        auto& enemy = g_enemies[i];
        if (!enemy || enemy->isRemoved() || enemy->isDead()) continue;
        if (g_bigWaveHitEnemyFlags[i] != 0) continue;

        if (tileInArea(impactedTiles, enemy->tilePos())) {
            enemy->applyDamage(damage, nowMs, g_player->tilePos());
            g_bigWaveHitEnemyFlags[i] = 1;
        }
    }
}

void resolveEnemyAttack(float nowMs) {
    if (!g_player) return;
    if (g_player->isDead()) return;

    std::int32_t totalDamage = 0;
    for (const auto& enemy : g_enemies) {
        if (!enemy || enemy->isRemoved() || enemy->isDead()) continue;
        if (!enemy->consumeAttackImpactReady()) continue;

        if (tileInArea(enemy->attackAreaTiles(), g_player->tilePos())) {
            totalDamage += enemy->role().stats().attackPower;
        }
    }

    if (totalDamage > 0) {
        // 同一帧多怪命中只触发一次受击动画：合并伤害后只调用一次 applyDamage。
        g_player->applyDamage(totalDamage, nowMs);
    }
}

void processEnemyTurnLogic(std::int32_t currentTurn, TilePos playerTile, float nowMs) {
    if (g_enemyTurnCursor >= static_cast<std::int32_t>(g_enemies.size())) return;

    while (g_enemyTurnCursor < static_cast<std::int32_t>(g_enemies.size())) {
        const std::int32_t enemyIndex = g_enemyTurnCursor;
        ++g_enemyTurnCursor;

        auto* enemy = enemyAtIndex(enemyIndex);
        if (!enemy || enemy->isDead() || enemy->isRemoved()) continue;

        const auto enemyBlockQuery = [playerTile, enemyIndex](std::int32_t x, std::int32_t y) {
            return isBlockedForEnemy(x, y, playerTile, enemyIndex);
        };

        // 按列表顺序执行本回合决策，动画会在后续 update 中并发播放。
        enemy->onPlayerTurnAdvanced(currentTurn, playerTile, nowMs, enemyBlockQuery);
    }
}

void updateEnemies(float nowMs, TilePos playerTile) {
    for (std::size_t i = 0; i < g_enemies.size(); ++i) {
        auto* enemy = enemyAtIndex(static_cast<std::int32_t>(i));
        if (!enemy) continue;
        const auto enemyBlockQuery = [playerTile, i](std::int32_t x, std::int32_t y) {
            return isBlockedForEnemy(x, y, playerTile, static_cast<std::int32_t>(i));
        };
        enemy->update(nowMs, enemyBlockQuery);
    }
}

} // namespace

extern "C" {

GC_KEEPALIVE void gc_init(
    float tileWidth,
    float tileHeight,
    float worldScale,
    float feetOffsetY,
    float moveDurationMs,
    float attackDurationMs,
    float deadZoneRatioX,
    float topDeadZoneRatioY,
    float bottomDeadZoneRatioY
) {
    g_playerConfig = PlayerConfig{};
    g_playerConfig.tileWidth = tileWidth;
    g_playerConfig.tileHeight = tileHeight;
    g_playerConfig.worldScale = worldScale;
    g_playerConfig.feetOffsetY = feetOffsetY;
    g_playerConfig.moveDurationMs = moveDurationMs;
    g_playerConfig.attackDurationMs = attackDurationMs;

    g_cameraConfig = CameraConfig{};
    g_cameraConfig.deadZoneRatioX = deadZoneRatioX;
    g_cameraConfig.topDeadZoneRatioY = topDeadZoneRatioY;
    g_cameraConfig.bottomDeadZoneRatioY = bottomDeadZoneRatioY;

    g_monsterConfig = MonsterConfig{};
    g_monsterConfig.tileWidth = tileWidth;
    g_monsterConfig.tileHeight = tileHeight;
    g_monsterConfig.worldScale = worldScale;
    g_monsterConfig.feetOffsetY = feetOffsetY;
    g_monsterConfig.moveDurationMs = moveDurationMs;
    g_monsterConfig.attackDurationMs = 1000.0f;

    g_player.reset();
    g_enemies.clear();
    g_camera.reset();
    ensureControllersInitialized();
    resetCombatRuntimeState();
}

GC_KEEPALIVE void gc_set_world(float worldWidth, float worldHeight) {
    g_worldWidth = std::max(0.0f, worldWidth);
    g_worldHeight = std::max(0.0f, worldHeight);
}

GC_KEEPALIVE void gc_set_viewport(float viewportWidth, float viewportHeight) {
    g_viewportWidth = std::max(0.0f, viewportWidth);
    g_viewportHeight = std::max(0.0f, viewportHeight);
}

GC_KEEPALIVE void gc_set_collision_grid(
    std::int32_t width,
    std::int32_t height,
    std::int32_t collisionYOffset,
    const std::uint8_t* solidData,
    std::int32_t length
) {
    g_mapWidth = std::max(0, width);
    g_mapHeight = std::max(0, height);
    g_collisionYOffset = collisionYOffset;

    if (!solidData || length <= 0) {
        g_baseSolidGrid.clear();
        for (auto& enemy : g_enemies) {
            if (enemy) enemy->onMapSwitched();
        }
        return;
    }

    g_baseSolidGrid.assign(solidData, solidData + length);
    for (auto& enemy : g_enemies) {
        if (enemy) enemy->onMapSwitched();
    }
}

GC_KEEPALIVE void gc_set_spawn(std::int32_t tileX, std::int32_t tileY) {
    ensureControllersInitialized();
    if (!g_player || !g_camera) return;
    g_player->setSpawn(TilePos{tileX, tileY});
    g_player->revive(0.0f);
    g_playerSpawned = true;
    g_lastProcessedTurn = g_player->currentTurn();
    g_camera->centerOn(g_player->worldPos(), bounds());
}

GC_KEEPALIVE void gc_enemy_set_spawn(std::int32_t tileX, std::int32_t tileY) {
    ensureControllersInitialized();
    ensureEnemiesSize(1);
    auto* enemy = enemyAtIndex(0);
    if (!enemy) return;
    enemy->setSpawn(TilePos{tileX, tileY});
}

GC_KEEPALIVE void gc_enemy_set_spawn_at(std::int32_t index, std::int32_t tileX, std::int32_t tileY) {
    if (index < 0) return;
    ensureControllersInitialized();
    ensureEnemiesSize(static_cast<std::size_t>(index + 1));
    auto* enemy = enemyAtIndex(index);
    if (!enemy) return;
    enemy->setSpawn(TilePos{tileX, tileY});
}

GC_KEEPALIVE void gc_set_player_role(std::int32_t roleKind) {
    const CharacterRole role = roleFromKindInt(roleKind);
    g_player = std::make_unique<PlayerController>(g_playerConfig, role);
    resetCombatRuntimeState();
}

GC_KEEPALIVE std::int32_t gc_enemy_count() {
    return static_cast<std::int32_t>(g_enemies.size());
}

GC_KEEPALIVE void gc_center_camera() {
    ensureControllersInitialized();
    if (!g_player || !g_camera) return;
    g_camera->centerOn(g_player->worldPos(), bounds());
}

// 在 cpp/src/web/GameCoreBridge.cpp 中修改这个函数：

GC_KEEPALIVE void gc_request_move(std::int32_t dx, std::int32_t dy, float nowMs) {
    if (!g_player || g_player->isDead()) return;

    // 遍历当前队列，看看是否已经有移动指令在排队
    for (auto& cmd : g_playerCommandQueue) {
        if (cmd.type == PlayerCommandType::Move) {
            // 如果已经有排队的移动指令，我们不增加队列长度，而是直接【覆盖】它的方向！
            // 这样既防止了“刹不住车”，又能让玩家长按变向时实现极速响应
            cmd.dx = dx;
            cmd.dy = dy;
            cmd.nowMs = nowMs;
            return; 
        }
    }

    // 如果队列里目前没有移动指令，才推入新的
    g_playerCommandQueue.push_back(PlayerCommand{PlayerCommandType::Move, dx, dy, nowMs});
}

GC_KEEPALIVE void gc_request_attack(float nowMs) {
    if (!g_player || g_player->isDead()) return;
    g_playerCommandQueue.push_back(PlayerCommand{PlayerCommandType::Attack, 0, 0, nowMs});
}

GC_KEEPALIVE void gc_request_small_skill(float nowMs) {
    if (!g_player || g_player->isDead()) return;
    g_playerCommandQueue.push_back(PlayerCommand{PlayerCommandType::SmallSkill, 0, 0, nowMs});
}

GC_KEEPALIVE void gc_request_big_skill(float nowMs) {
    if (!g_player || g_player->isDead()) return;
    g_playerCommandQueue.push_back(PlayerCommand{PlayerCommandType::BigSkill, 0, 0, nowMs});
}

GC_KEEPALIVE void gc_player_revive(float nowMs) {
    if (!g_player) return;
    g_player->revive(nowMs);
    g_playerCommandQueue.clear();
    g_prevBigWaveActive = false;
    g_prevBigWaveFrontDistance = -999;
    g_bigWaveHitEnemyFlags.assign(g_enemies.size(), 0);
    g_bigWaveDamageSnapshot = 0;
    g_lastProcessedTurn = g_player->currentTurn();
}

GC_KEEPALIVE void gc_update(float nowMs) {
    ensureControllersInitialized();
    if (!g_player || !g_camera) return;

    if (!g_playerSpawned) return;

    const bool allowPlayerStartAction = !isEnemyAnimating();
    g_player->update(nowMs, isBlockedForPlayer, hasEnemyAt, allowPlayerStartAction);
    resolvePlayerAttack(nowMs);

    const TilePos playerTile = g_player->tilePos();
    const std::int32_t currentTurn = g_player->currentTurn();
    if (currentTurn != g_lastProcessedTurn) {
        g_lastProcessedTurn = currentTurn;
        resolveArcherBlessingVolley(nowMs);
        g_enemyTurnCursor = 0;
        processEnemyTurnLogic(currentTurn, playerTile, nowMs);
    }

    updateEnemies(nowMs, playerTile);
    resolveEnemyAttack(nowMs);
    resolvePlayerBigWaveDamage(nowMs);

    g_prevPlayerAttacking = g_player->isAttacking();
    tryDispatchNextPlayerCommand(nowMs);
    g_camera->updateFollow(g_player->worldPos(), bounds());
}

GC_KEEPALIVE std::int32_t gc_player_tile_x() {
    if (!g_player) return 0;
    return g_player->tilePos().x;
}

GC_KEEPALIVE std::int32_t gc_player_tile_y() {
    if (!g_player) return 0;
    return g_player->tilePos().y;
}

GC_KEEPALIVE float gc_player_world_x() {
    if (!g_player) return 0.0f;
    return g_player->worldPos().x;
}

GC_KEEPALIVE float gc_player_world_y() {
    if (!g_player) return 0.0f;
    return g_player->worldPos().y;
}

GC_KEEPALIVE std::int32_t gc_player_facing_x() {
    if (!g_player) return 1;
    return g_player->facing() == Facing::Left ? -1 : 1;
}

GC_KEEPALIVE std::int32_t gc_player_facing_y() {
    if (!g_player) return 0;
    switch(g_player->facing()) {
        case Facing::Up:    return -1;
        case Facing::Down:  return 1;
        default:            return 0;
    }
}

GC_KEEPALIVE std::int32_t gc_player_is_walking() {
    if (!g_player) return 0;
    return g_player->isWalkingAnimation() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_is_moving() {
    if (!g_player) return 0;
    return g_player->isMoving() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_is_attacking() {
    if (!g_player) return 0;
    return g_player->isAttacking() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_is_hurt() {
    if (!g_player) return 0;
    return g_player->isHurt() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_is_dead() {
    if (!g_player) return 0;
    return g_player->isDead() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_death_finished() {
    if (!g_player) return 0;
    return g_player->deathAnimationFinished() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_current_hp() {
    if (!g_player) return 0;
    return g_player->currentHp();
}

GC_KEEPALIVE std::int32_t gc_player_attack_variant() {
    if (!g_player) return 0;
    return g_player->attackVariant();
}

GC_KEEPALIVE const char* gc_player_role_name() {
    if (!g_player) return "";
    return g_player->role().displayName().c_str();
}

GC_KEEPALIVE std::int32_t gc_player_max_hp() {
    if (!g_player) return 0;
    return g_player->role().stats().maxHp;
}

GC_KEEPALIVE std::int32_t gc_player_attack_power() {
    if (!g_player) return 0;
    return g_player->role().stats().attackPower;
}

GC_KEEPALIVE std::int32_t gc_player_attack_power_percent() {
    if (!g_player) return 100;
    return g_player->attackDamageScalePercent();
}

GC_KEEPALIVE std::int32_t gc_player_auto_lock_enabled() {
    if (!g_player) return 1;
    return g_player->attackUsesAutoLock() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_small_skill_active() {
    if (!g_player) return 0;
    return g_player->isSmallSkillActive() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_small_skill_turns_left() {
    if (!g_player) return 0;
    return g_player->smallSkillTurnsLeft();
}

GC_KEEPALIVE std::int32_t gc_player_small_skill_cooldown_left() {
    if (!g_player) return 0;
    return g_player->smallSkillCooldownTurnsLeft();
}

GC_KEEPALIVE std::int32_t gc_player_big_skill_cooldown_left() {
    if (!g_player) return 0;
    return g_player->bigSkillCooldownTurnsLeft();
}

GC_KEEPALIVE std::int32_t gc_player_big_wave_active() {
    if (!g_player) return 0;
    return g_player->isBigWaveActive() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_archer_blessing_active() {
    if (!g_player) return 0;
    return g_player->isArcherBlessingActive() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_player_attack_area_count() {
    if (!g_player) return 0;
    return static_cast<std::int32_t>(g_player->attackAreaTiles().size());
}

GC_KEEPALIVE std::int32_t gc_player_attack_area_x(std::int32_t index) {
    if (!g_player || index < 0) return 0;
    const auto tiles = g_player->attackAreaTiles();
    if (index >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(index)].x;
}

GC_KEEPALIVE std::int32_t gc_player_attack_area_y(std::int32_t index) {
    if (!g_player || index < 0) return 0;
    const auto tiles = g_player->attackAreaTiles();
    if (index >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(index)].y;
}

GC_KEEPALIVE std::int32_t gc_player_big_wave_area_count() {
    if (!g_player) return 0;
    return static_cast<std::int32_t>(g_player->bigWaveTiles().size());
}

GC_KEEPALIVE std::int32_t gc_player_big_wave_area_x(std::int32_t index) {
    if (!g_player || index < 0) return 0;
    const auto tiles = g_player->bigWaveTiles();
    if (index >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(index)].x;
}

GC_KEEPALIVE std::int32_t gc_player_big_wave_area_y(std::int32_t index) {
    if (!g_player || index < 0) return 0;
    const auto tiles = g_player->bigWaveTiles();
    if (index >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(index)].y;
}

GC_KEEPALIVE float gc_camera_x() {
    if (!g_camera) return 0.0f;
    return g_camera->position().x;
}

GC_KEEPALIVE float gc_camera_y() {
    if (!g_camera) return 0.0f;
    return g_camera->position().y;
}

// ---- Legacy single-enemy APIs (compatible wrappers) ----
GC_KEEPALIVE std::int32_t gc_enemy_tile_x() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->tilePos().x;
}

GC_KEEPALIVE std::int32_t gc_enemy_tile_y() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->tilePos().y;
}

GC_KEEPALIVE float gc_enemy_world_x() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0.0f;
    return enemy->worldPos().x;
}

GC_KEEPALIVE float gc_enemy_world_y() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0.0f;
    return enemy->worldPos().y;
}

GC_KEEPALIVE std::int32_t gc_enemy_facing_x() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return -1;
    return enemy->facing() == Facing::Left ? -1 : 1;
}

GC_KEEPALIVE std::int32_t gc_enemy_facing_y() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    switch(enemy->facing()) {
        case Facing::Up:    return -1;
        case Facing::Down:  return 1;
        default:            return 0;
    }
}

GC_KEEPALIVE std::int32_t gc_enemy_is_walking() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->isWalkingAnimation() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_attacking() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->isAttacking() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_hurt() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->isHurt() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_dead() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->isDead() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_removed() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 1;
    return enemy->isRemoved() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_variant() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->attackVariant();
}

GC_KEEPALIVE std::int32_t gc_enemy_is_discovered() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->isDiscovered() ? 1 : 0;
}

GC_KEEPALIVE const char* gc_enemy_role_name() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return "";
    return enemy->role().displayName().c_str();
}

GC_KEEPALIVE std::int32_t gc_enemy_max_hp() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->role().stats().maxHp;
}

GC_KEEPALIVE std::int32_t gc_enemy_current_hp() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->currentHp();
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_power() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return enemy->role().stats().attackPower;
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_area_count() {
    const auto* enemy = legacyEnemy();
    if (!enemy) return 0;
    return static_cast<std::int32_t>(enemy->attackAreaTiles().size());
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_area_x(std::int32_t index) {
    const auto* enemy = legacyEnemy();
    if (!enemy || index < 0) return 0;
    const auto tiles = enemy->attackAreaTiles();
    if (index >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(index)].x;
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_area_y(std::int32_t index) {
    const auto* enemy = legacyEnemy();
    if (!enemy || index < 0) return 0;
    const auto tiles = enemy->attackAreaTiles();
    if (index >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(index)].y;
}

// ---- Multi-enemy indexed APIs ----
GC_KEEPALIVE std::int32_t gc_enemy_tile_x_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return enemy->tilePos().x;
}

GC_KEEPALIVE std::int32_t gc_enemy_tile_y_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return enemy->tilePos().y;
}

GC_KEEPALIVE float gc_enemy_world_x_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0.0f;
    return enemy->worldPos().x;
}

GC_KEEPALIVE float gc_enemy_world_y_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0.0f;
    return enemy->worldPos().y;
}

GC_KEEPALIVE std::int32_t gc_enemy_facing_x_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return -1;
    return enemy->facing() == Facing::Left ? -1 : 1;
}

GC_KEEPALIVE std::int32_t gc_enemy_facing_y_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    switch(enemy->facing()) {
        case Facing::Up:    return -1;
        case Facing::Down:  return 1;
        default:            return 0;
    }
}

GC_KEEPALIVE std::int32_t gc_enemy_is_walking_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return enemy->isWalkingAnimation() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_attacking_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return enemy->isAttacking() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_hurt_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return enemy->isHurt() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_dead_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return enemy->isDead() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_removed_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 1;
    return enemy->isRemoved() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_variant_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return enemy->attackVariant();
}

GC_KEEPALIVE std::int32_t gc_enemy_is_discovered_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return enemy->isDiscovered() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_current_hp_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return enemy->currentHp();
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_area_count_at(std::int32_t enemyIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy) return 0;
    return static_cast<std::int32_t>(enemy->attackAreaTiles().size());
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_area_x_at(std::int32_t enemyIndex, std::int32_t tileIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy || tileIndex < 0) return 0;
    const auto tiles = enemy->attackAreaTiles();
    if (tileIndex >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(tileIndex)].x;
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_area_y_at(std::int32_t enemyIndex, std::int32_t tileIndex) {
    const auto* enemy = enemyAtIndex(enemyIndex);
    if (!enemy || tileIndex < 0) return 0;
    const auto tiles = enemy->attackAreaTiles();
    if (tileIndex >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(tileIndex)].y;
}

} // extern "C"
