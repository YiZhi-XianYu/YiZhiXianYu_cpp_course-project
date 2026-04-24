#include <algorithm>
#include <cstddef>
#include <cstdint>
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
using core::Facing;
using core::MonsterConfig;
using core::MonsterController;
using core::PlayerConfig;
using core::PlayerController;
using core::TilePos;

std::unique_ptr<PlayerController> g_player;
std::unique_ptr<MonsterController> g_enemy;
std::unique_ptr<CameraController> g_camera;
std::int32_t g_lastProcessedTurn = -1;
bool g_prevPlayerAttacking = false;
bool g_prevEnemyAttacking = false;

std::vector<std::uint8_t> g_baseSolidGrid;
std::int32_t g_mapWidth = 0;
std::int32_t g_mapHeight = 0;
std::int32_t g_collisionYOffset = -2;

float g_worldWidth = 0.0f;
float g_worldHeight = 0.0f;
float g_viewportWidth = 0.0f;
float g_viewportHeight = 0.0f;

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
    if (!g_enemy || g_enemy->isRemoved()) return false;
    const TilePos pos = g_enemy->tilePos();
    return pos.x == x && pos.y == y;
}

bool isBlockedForPlayer(std::int32_t x, std::int32_t y) {
    if (isBlocked(x, y)) return true;
    return hasEnemyAt(x, y);
}

bool isBlockedForEnemy(std::int32_t x, std::int32_t y, TilePos playerTile) {
    if (isBlocked(x, y)) return true;
    return x == playerTile.x && y == playerTile.y;
}

bool tileInArea(const std::vector<TilePos>& tiles, TilePos tile) {
    return std::any_of(tiles.begin(), tiles.end(), [tile](const TilePos& areaTile) {
        return areaTile.x == tile.x && areaTile.y == tile.y;
    });
}

void resolvePlayerAttack(float nowMs) {
    if (!g_player || !g_enemy) return;
    if (g_player->isDead() || g_enemy->isDead() || g_enemy->isRemoved()) return;
    if (!g_player->isAttacking() || g_prevPlayerAttacking) return;

    std::vector<TilePos> attackTiles = g_player->attackAreaTiles();
    const auto bigWaveTiles = g_player->bigWaveTiles();
    attackTiles.insert(attackTiles.end(), bigWaveTiles.begin(), bigWaveTiles.end());

    if (tileInArea(attackTiles, g_enemy->tilePos())) {
        g_enemy->applyDamage(g_player->currentAttackPower(), nowMs, g_player->tilePos());
    }
}

void resolveEnemyAttack(float nowMs) {
    if (!g_player || !g_enemy) return;
    if (g_player->isDead() || g_enemy->isDead() || g_enemy->isRemoved()) return;
    if (!g_enemy->isAttacking() || g_prevEnemyAttacking) return;

    if (tileInArea(g_enemy->attackAreaTiles(), g_player->tilePos())) {
        g_player->applyDamage(g_enemy->role().stats().attackPower, nowMs);
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
    PlayerConfig playerConfig{};
    playerConfig.tileWidth = tileWidth;
    playerConfig.tileHeight = tileHeight;
    playerConfig.worldScale = worldScale;
    playerConfig.feetOffsetY = feetOffsetY;
    playerConfig.moveDurationMs = moveDurationMs;
    playerConfig.attackDurationMs = attackDurationMs;

    CameraConfig cameraConfig{};
    cameraConfig.deadZoneRatioX = deadZoneRatioX;
    cameraConfig.topDeadZoneRatioY = topDeadZoneRatioY;
    cameraConfig.bottomDeadZoneRatioY = bottomDeadZoneRatioY;

    MonsterConfig monsterConfig{};
    monsterConfig.tileWidth = tileWidth;
    monsterConfig.tileHeight = tileHeight;
    monsterConfig.worldScale = worldScale;
    monsterConfig.feetOffsetY = feetOffsetY;
    monsterConfig.moveDurationMs = moveDurationMs;
    monsterConfig.attackDurationMs = 1000.0f;

    g_player = std::make_unique<PlayerController>(playerConfig);
    g_enemy = std::make_unique<MonsterController>(monsterConfig);
    g_camera = std::make_unique<CameraController>(cameraConfig);
    g_lastProcessedTurn = -1;
    g_prevPlayerAttacking = false;
    g_prevEnemyAttacking = false;
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
        if (g_enemy) g_enemy->onMapSwitched();
        return;
    }

    g_baseSolidGrid.assign(solidData, solidData + length);
    if (g_enemy) g_enemy->onMapSwitched();
}

GC_KEEPALIVE void gc_set_spawn(std::int32_t tileX, std::int32_t tileY) {
    if (!g_player || !g_camera) return;
    g_player->setSpawn(TilePos{tileX, tileY});
    g_lastProcessedTurn = g_player->currentTurn();
    g_prevPlayerAttacking = false;
    g_camera->centerOn(g_player->worldPos(), bounds());
}

GC_KEEPALIVE void gc_enemy_set_spawn(std::int32_t tileX, std::int32_t tileY) {
    if (!g_enemy) return;
    g_enemy->setSpawn(TilePos{tileX, tileY});
    g_prevEnemyAttacking = false;
}

GC_KEEPALIVE void gc_center_camera() {
    if (!g_player || !g_camera) return;
    g_camera->centerOn(g_player->worldPos(), bounds());
}

GC_KEEPALIVE void gc_request_move(std::int32_t dx, std::int32_t dy, float nowMs) {
    if (!g_player) return;
    g_player->requestMove(dx, dy, nowMs, isBlockedForPlayer);
}

GC_KEEPALIVE void gc_request_attack(float nowMs) {
    if (!g_player || g_player->isDead()) return;
    g_player->requestAttack(nowMs);
}

GC_KEEPALIVE void gc_request_small_skill(float nowMs) {
    if (!g_player || g_player->isDead()) return;
    g_player->requestSmallSkill(nowMs);
}

GC_KEEPALIVE void gc_request_big_skill(float nowMs) {
    if (!g_player || g_player->isDead()) return;
    g_player->requestBigSkill(nowMs);
}

GC_KEEPALIVE void gc_player_revive(float nowMs) {
    if (!g_player) return;
    g_player->revive(nowMs);
    g_lastProcessedTurn = g_player->currentTurn();
    g_prevPlayerAttacking = false;
}

GC_KEEPALIVE void gc_update(float nowMs) {
    if (!g_player || !g_camera) return;

    g_player->update(nowMs, isBlockedForPlayer);
    resolvePlayerAttack(nowMs);

    if (g_enemy) {
        const TilePos playerTile = g_player->tilePos();
        const auto enemyBlockQuery = [playerTile](std::int32_t x, std::int32_t y) {
            return isBlockedForEnemy(x, y, playerTile);
        };

        if (!g_enemy->isDead() && !g_enemy->isRemoved()) {
            const std::int32_t currentTurn = g_player->currentTurn();
            if (currentTurn != g_lastProcessedTurn) {
                g_lastProcessedTurn = currentTurn;
                g_enemy->onPlayerTurnAdvanced(currentTurn, playerTile, nowMs, enemyBlockQuery);
            }
        }

        g_enemy->update(nowMs, enemyBlockQuery);
        resolveEnemyAttack(nowMs);

        g_prevEnemyAttacking = g_enemy->isAttacking();
    }

    g_prevPlayerAttacking = g_player->isAttacking();

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
    if (!g_player) return 1;
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

GC_KEEPALIVE std::int32_t gc_enemy_tile_x() {
    if (!g_enemy) return 0;
    return g_enemy->tilePos().x;
}

GC_KEEPALIVE std::int32_t gc_enemy_tile_y() {
    if (!g_enemy) return 0;
    return g_enemy->tilePos().y;
}

GC_KEEPALIVE float gc_enemy_world_x() {
    if (!g_enemy) return 0.0f;
    return g_enemy->worldPos().x;
}

GC_KEEPALIVE float gc_enemy_world_y() {
    if (!g_enemy) return 0.0f;
    return g_enemy->worldPos().y;
}

GC_KEEPALIVE std::int32_t gc_enemy_facing_x() {
    if (!g_enemy) return -1;
    return g_enemy->facing() == Facing::Left ? -1 : 1;
}

GC_KEEPALIVE std::int32_t gc_enemy_facing_y() {
    if (!g_enemy) return 0;
    switch(g_enemy->facing()) {
        case Facing::Up:    return -1;
        case Facing::Down:  return 1;
        default:            return 0;
    }
}

GC_KEEPALIVE std::int32_t gc_enemy_is_walking() {
    if (!g_enemy) return 0;
    return g_enemy->isWalkingAnimation() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_attacking() {
    if (!g_enemy) return 0;
    return g_enemy->isAttacking() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_hurt() {
    if (!g_enemy) return 0;
    return g_enemy->isHurt() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_dead() {
    if (!g_enemy) return 0;
    return g_enemy->isDead() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_is_removed() {
    if (!g_enemy) return 1;
    return g_enemy->isRemoved() ? 1 : 0;
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_variant() {
    if (!g_enemy) return 0;
    return g_enemy->attackVariant();
}

GC_KEEPALIVE std::int32_t gc_enemy_is_discovered() {
    if (!g_enemy) return 0;
    return g_enemy->isDiscovered() ? 1 : 0;
}

GC_KEEPALIVE const char* gc_enemy_role_name() {
    if (!g_enemy) return "";
    return g_enemy->role().displayName().c_str();
}

GC_KEEPALIVE std::int32_t gc_enemy_max_hp() {
    if (!g_enemy) return 0;
    return g_enemy->role().stats().maxHp;
}

GC_KEEPALIVE std::int32_t gc_enemy_current_hp() {
    if (!g_enemy) return 0;
    return g_enemy->currentHp();
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_power() {
    if (!g_enemy) return 0;
    return g_enemy->role().stats().attackPower;
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_area_count() {
    if (!g_enemy) return 0;
    return static_cast<std::int32_t>(g_enemy->attackAreaTiles().size());
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_area_x(std::int32_t index) {
    if (!g_enemy || index < 0) return 0;
    const auto tiles = g_enemy->attackAreaTiles();
    if (index >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(index)].x;
}

GC_KEEPALIVE std::int32_t gc_enemy_attack_area_y(std::int32_t index) {
    if (!g_enemy || index < 0) return 0;
    const auto tiles = g_enemy->attackAreaTiles();
    if (index >= static_cast<std::int32_t>(tiles.size())) return 0;
    return tiles[static_cast<std::size_t>(index)].y;
}

} // extern "C"
