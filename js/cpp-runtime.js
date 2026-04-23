function createJsFallbackRuntime() {
    const state = {
        tileWidth: 32,
        tileHeight: 32,
        worldScale: 1,
        feetOffsetY: 0,
        moveDurationMs: 180,
        deadZoneRatioX: 0.2,
        topDeadZoneRatioY: 0.1,
        bottomDeadZoneRatioY: 0.4,
        worldWidth: 0,
        worldHeight: 0,
        viewportWidth: 1,
        viewportHeight: 1,
        collisionWidth: 0,
        collisionHeight: 0,
        collisionYOffset: 0,
        solidGrid: null,
        tileX: 0,
        tileY: 0,
        fromX: 0,
        fromY: 0,
        toX: 0,
        toY: 0,
        moveStartMs: 0,
        moving: false,
        hasMoveStart: false,
        facingX: 1,
        queuedMove: null,
        cameraX: 0,
        cameraY: 0
    };

    function tileCenterX(tileX) {
        return (tileX + 0.5) * state.tileWidth * state.worldScale;
    }

    function tileCenterY(tileY) {
        return (tileY + 1) * state.tileHeight * state.worldScale - state.feetOffsetY;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function canMoveTo(tileX, tileY) {
        if (
            tileX < 0 ||
            tileY < 0 ||
            tileX >= state.collisionWidth ||
            tileY >= state.collisionHeight
        ) {
            return false;
        }

        if (!state.solidGrid) return true;

        const sampleY = tileY + state.collisionYOffset;
        if (sampleY < 0 || sampleY >= state.collisionHeight) return false;

        const index = sampleY * state.collisionWidth + tileX;
        return state.solidGrid[index] !== 1;
    }

    function worldPos(nowMs) {
        if (!state.moving) {
            return {
                x: tileCenterX(state.tileX),
                y: tileCenterY(state.tileY)
            };
        }

        const duration = Math.max(1, state.moveDurationMs);
        const elapsed = Math.max(0, (nowMs ?? 0) - state.moveStartMs);
        const t = Math.min(1, elapsed / duration);
        const interpTileX = state.fromX + (state.toX - state.fromX) * t;
        const interpTileY = state.fromY + (state.toY - state.fromY) * t;

        return {
            x: tileCenterX(interpTileX),
            y: tileCenterY(interpTileY)
        };
    }

    function updateCamera(nowMs) {
        const player = worldPos(nowMs);
        const worldMaxX = Math.max(0, state.worldWidth - state.viewportWidth);
        const worldMaxY = Math.max(0, state.worldHeight - state.viewportHeight);

        const deadZoneHalfWidth = state.viewportWidth * state.deadZoneRatioX;
        const topDeadHalfHeight = state.viewportHeight * state.topDeadZoneRatioY;
        const bottomDeadHalfHeight = state.viewportHeight * state.bottomDeadZoneRatioY;

        const leftBound = state.cameraX + state.viewportWidth / 2 - deadZoneHalfWidth;
        const rightBound = state.cameraX + state.viewportWidth / 2 + deadZoneHalfWidth;
        const topBound = state.cameraY + state.viewportHeight / 2 - topDeadHalfHeight;
        const bottomBound = state.cameraY + state.viewportHeight / 2 + bottomDeadHalfHeight;

        if (player.x < leftBound) {
            state.cameraX -= leftBound - player.x;
        } else if (player.x > rightBound) {
            state.cameraX += player.x - rightBound;
        }

        if (player.y < topBound) {
            state.cameraY -= topBound - player.y;
        } else if (player.y > bottomBound) {
            state.cameraY += player.y - bottomBound;
        }

        state.cameraX = clamp(state.cameraX, 0, worldMaxX);
        state.cameraY = clamp(state.cameraY, 0, worldMaxY);
    }

    function beginMove(dx, dy, nowMs) {
        const targetX = state.tileX + dx;
        const targetY = state.tileY + dy;
        if (!canMoveTo(targetX, targetY)) return;

        state.fromX = state.tileX;
        state.fromY = state.tileY;
        state.toX = targetX;
        state.toY = targetY;
        state.moveStartMs = nowMs ?? performance.now();
        state.hasMoveStart = true;
        state.moving = true;
        if (dx !== 0) {
            state.facingX = dx < 0 ? -1 : 1;
        }
    }

    function consumeQueuedMove(nowMs) {
        if (!state.queuedMove) return;
        const next = state.queuedMove;
        state.queuedMove = null;
        beginMove(next.dx, next.dy, nowMs);
    }

    return {
        init(config) {
            state.tileWidth = config.tileWidth;
            state.tileHeight = config.tileHeight;
            state.worldScale = config.worldScale;
            state.feetOffsetY = config.feetOffsetY;
            state.moveDurationMs = config.moveDurationMs;
            state.deadZoneRatioX = config.deadZoneRatioX;
            state.topDeadZoneRatioY = config.topDeadZoneRatioY;
            state.bottomDeadZoneRatioY = config.bottomDeadZoneRatioY;
        },
        setWorld(worldWidth, worldHeight) {
            state.worldWidth = worldWidth;
            state.worldHeight = worldHeight;
            updateCamera(performance.now());
        },
        setViewport(viewportWidth, viewportHeight) {
            state.viewportWidth = Math.max(1, viewportWidth);
            state.viewportHeight = Math.max(1, viewportHeight);
            updateCamera(performance.now());
        },
        setCollisionGrid(width, height, collisionYOffset, solidGrid) {
            state.collisionWidth = width;
            state.collisionHeight = height;
            state.collisionYOffset = collisionYOffset;
            state.solidGrid = solidGrid;
        },
        setSpawn(tileX, tileY) {
            state.tileX = tileX;
            state.tileY = tileY;
            state.fromX = tileX;
            state.fromY = tileY;
            state.toX = tileX;
            state.toY = tileY;
            state.moving = false;
            state.queuedMove = null;
            updateCamera(performance.now());
        },
        centerCamera() {
            const player = worldPos(performance.now());
            const worldMaxX = Math.max(0, state.worldWidth - state.viewportWidth);
            const worldMaxY = Math.max(0, state.worldHeight - state.viewportHeight);
            state.cameraX = clamp(player.x - state.viewportWidth / 2, 0, worldMaxX);
            state.cameraY = clamp(player.y - state.viewportHeight / 2, 0, worldMaxY);
        },
        requestMove(dx, dy, nowMs) {
            if (dx === 0 && dy === 0) return;

            if (state.moving) {
                state.queuedMove = { dx, dy };
                if (dx !== 0) {
                    state.facingX = dx < 0 ? -1 : 1;
                }
                return;
            }

            beginMove(dx, dy, nowMs ?? performance.now());
        },
        update(nowMs) {
            const now = nowMs ?? performance.now();

            if (state.moving) {
                if (!state.hasMoveStart) {
                    state.moveStartMs = now;
                    state.hasMoveStart = true;
                }

                const elapsed = now - state.moveStartMs;
                if (elapsed >= state.moveDurationMs) {
                    state.tileX = state.toX;
                    state.tileY = state.toY;
                    state.fromX = state.tileX;
                    state.fromY = state.tileY;
                    state.moving = false;
                    state.hasMoveStart = false;
                    consumeQueuedMove(now);
                }
            }

            updateCamera(now);
        },
        playerTileX() {
            return state.tileX;
        },
        playerTileY() {
            return state.tileY;
        },
        playerWorldX() {
            return worldPos(performance.now()).x;
        },
        playerWorldY() {
            return worldPos(performance.now()).y;
        },
        playerFacingX() {
            return state.facingX;
        },
        playerIsWalking() {
            return state.moving;
        },
        playerIsMoving() {
            return state.moving;
        },
        playerSmallSkillActive() {
            return false;
        },
        playerSmallSkillTurnsLeft() {
            return 0;
        },
        playerSmallSkillCooldownLeft() {
            return 0;
        },
        playerBigSkillCooldownLeft() {
            return 0;
        },
        playerBigWaveActive() {
            return false;
        },
        playerAttackPowerPercent() {
            return 100;
        },
        playerAutoLockEnabled() {
            return true;
        },
        playerAttackAreaCount() {
            return 0;
        },
        playerAttackAreaX() {
            return 0;
        },
        playerAttackAreaY() {
            return 0;
        },
        playerBigWaveAreaCount() {
            return 0;
        },
        playerBigWaveAreaX() {
            return 0;
        },
        playerBigWaveAreaY() {
            return 0;
        },
        cameraX() {
            return state.cameraX;
        },
        cameraY() {
            return state.cameraY;
        }
    };
}

async function createCppRuntime() {
    if (typeof createGameCoreModule !== 'function') {
        throw new Error('未找到 C++ WASM 模块工厂 createGameCoreModule。当前为仅 C++ 模式，请先构建并提供 cpp/web/game_core.js 与 game_core.wasm。');
    }

    const module = await createGameCoreModule();

    const api = {
        init: module.cwrap('gc_init', null, ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']),
        setWorld: module.cwrap('gc_set_world', null, ['number', 'number']),
        setViewport: module.cwrap('gc_set_viewport', null, ['number', 'number']),
        setCollisionGrid: module.cwrap('gc_set_collision_grid', null, ['number', 'number', 'number', 'array', 'number']),
        setSpawn: module.cwrap('gc_set_spawn', null, ['number', 'number']),
        centerCamera: module.cwrap('gc_center_camera', null, []),
        requestMove: module.cwrap('gc_request_move', null, ['number', 'number', 'number']),
        requestAttack: module.cwrap('gc_request_attack', null, ['number']),
        requestSmallSkill: module.cwrap('gc_request_small_skill', null, ['number']),
        requestBigSkill: module.cwrap('gc_request_big_skill', null, ['number']),
        update: module.cwrap('gc_update', null, ['number']),
        playerTileX: module.cwrap('gc_player_tile_x', 'number', []),
        playerTileY: module.cwrap('gc_player_tile_y', 'number', []),
        playerWorldX: module.cwrap('gc_player_world_x', 'number', []),
        playerWorldY: module.cwrap('gc_player_world_y', 'number', []),
        playerFacingX: module.cwrap('gc_player_facing_x', 'number', []),
        playerIsWalking: module.cwrap('gc_player_is_walking', 'number', []),
        playerIsMoving: module.cwrap('gc_player_is_moving', 'number', []),
        playerIsAttacking: module.cwrap('gc_player_is_attacking', 'number', []),
        playerAttackVariant: module.cwrap('gc_player_attack_variant', 'number', []),
        playerRoleName: module.cwrap('gc_player_role_name', 'string', []),
        playerMaxHp: module.cwrap('gc_player_max_hp', 'number', []),
        playerAttackPower: module.cwrap('gc_player_attack_power', 'number', []),
        playerAttackPowerPercent: module.cwrap('gc_player_attack_power_percent', 'number', []),
        playerAutoLockEnabled: module.cwrap('gc_player_auto_lock_enabled', 'number', []),
        playerSmallSkillActive: module.cwrap('gc_player_small_skill_active', 'number', []),
        playerSmallSkillTurnsLeft: module.cwrap('gc_player_small_skill_turns_left', 'number', []),
        playerSmallSkillCooldownLeft: module.cwrap('gc_player_small_skill_cooldown_left', 'number', []),
        playerBigSkillCooldownLeft: module.cwrap('gc_player_big_skill_cooldown_left', 'number', []),
        playerBigWaveActive: module.cwrap('gc_player_big_wave_active', 'number', []),
        playerAttackAreaCount: module.cwrap('gc_player_attack_area_count', 'number', []),
        playerAttackAreaX: module.cwrap('gc_player_attack_area_x', 'number', ['number']),
        playerAttackAreaY: module.cwrap('gc_player_attack_area_y', 'number', ['number']),
        playerBigWaveAreaCount: module.cwrap('gc_player_big_wave_area_count', 'number', []),
        playerBigWaveAreaX: module.cwrap('gc_player_big_wave_area_x', 'number', ['number']),
        playerBigWaveAreaY: module.cwrap('gc_player_big_wave_area_y', 'number', ['number']),
        cameraX: module.cwrap('gc_camera_x', 'number', []),
        cameraY: module.cwrap('gc_camera_y', 'number', [])
    };

    return {
        init(config) {
            api.init(
                config.tileWidth,
                config.tileHeight,
                config.worldScale,
                config.feetOffsetY,
                config.moveDurationMs,
                config.attackDurationMs,
                config.deadZoneRatioX,
                config.topDeadZoneRatioY,
                config.bottomDeadZoneRatioY
            );
        },
        setWorld(worldWidth, worldHeight) {
            api.setWorld(worldWidth, worldHeight);
        },
        setViewport(viewportWidth, viewportHeight) {
            api.setViewport(viewportWidth, viewportHeight);
        },
        setCollisionGrid(width, height, collisionYOffset, solidGrid) {
            api.setCollisionGrid(width, height, collisionYOffset, solidGrid, solidGrid.length);
        },
        setSpawn(tileX, tileY) {
            api.setSpawn(tileX, tileY);
        },
        centerCamera() {
            api.centerCamera();
        },
        requestMove(dx, dy, nowMs) {
            api.requestMove(dx, dy, nowMs);
        },
        requestAttack(nowMs) {
            api.requestAttack(nowMs);
        },
        requestSmallSkill(nowMs) {
            api.requestSmallSkill(nowMs);
        },
        requestBigSkill(nowMs) {
            api.requestBigSkill(nowMs);
        },
        update(nowMs) {
            api.update(nowMs);
        },
        playerTileX() {
            return api.playerTileX();
        },
        playerTileY() {
            return api.playerTileY();
        },
        playerWorldX() {
            return api.playerWorldX();
        },
        playerWorldY() {
            return api.playerWorldY();
        },
        playerFacingX() {
            return api.playerFacingX();
        },
        playerIsWalking() {
            return api.playerIsWalking() === 1;
        },
        playerIsMoving() {
            return api.playerIsMoving() === 1;
        },
        playerIsAttacking() {
            return api.playerIsAttacking() === 1;
        },
        playerAttackVariant() {
            return api.playerAttackVariant();
        },
        playerRoleName() {
            return api.playerRoleName();
        },
        playerMaxHp() {
            return api.playerMaxHp();
        },
        playerAttackPower() {
            return api.playerAttackPower();
        },
        playerAttackPowerPercent() {
            return api.playerAttackPowerPercent();
        },
        playerAutoLockEnabled() {
            return api.playerAutoLockEnabled() === 1;
        },
        playerSmallSkillActive() {
            return api.playerSmallSkillActive() === 1;
        },
        playerSmallSkillTurnsLeft() {
            return api.playerSmallSkillTurnsLeft();
        },
        playerSmallSkillCooldownLeft() {
            return api.playerSmallSkillCooldownLeft();
        },
        playerBigSkillCooldownLeft() {
            return api.playerBigSkillCooldownLeft();
        },
        playerBigWaveActive() {
            return api.playerBigWaveActive() === 1;
        },
        playerAttackAreaCount() {
            return api.playerAttackAreaCount();
        },
        playerAttackAreaX(index) {
            return api.playerAttackAreaX(index);
        },
        playerAttackAreaY(index) {
            return api.playerAttackAreaY(index);
        },
        playerBigWaveAreaCount() {
            return api.playerBigWaveAreaCount();
        },
        playerBigWaveAreaX(index) {
            return api.playerBigWaveAreaX(index);
        },
        playerBigWaveAreaY(index) {
            return api.playerBigWaveAreaY(index);
        },
        cameraX() {
            return api.cameraX();
        },
        cameraY() {
            return api.cameraY();
        }
    };
}
