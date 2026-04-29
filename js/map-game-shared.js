(function () {
    const DEFAULTS = {
        tileSize: 32,
        worldScale: 2,
        moveDurationMs: 180,
        attackDurationMs: 420,
        goblinAttackDurationMs: 420,
        viewportMarginX: 32,
        viewportMarginY: 120,
        cameraDeadzoneRatioX: 0.18,
        cameraTopDeadzoneRatioY: 0.08,
        cameraBottomDeadzoneRatioY: 0.48,
        soldierFrame: 100,
        soldierFeetOffsetY: 8,
        goblinFrame: 100,
        goblinAttackHighlightOffsetY: -2,
        collisionTileOffsetY: -2,
        mapBgmMaxVolume: 0.28,
        mapBgmFadeDurationMs: 900,
        mapBgmFadeStepMs: 50,
        attackSfxPaths: [
            '../assets/sound/07_human_atk_sword_1.wav',
            '../assets/sound/07_human_atk_sword_2.wav',
            '../assets/sound/07_human_atk_sword_3.wav'
        ],
        bowAttackSfxPaths: '../assets/sound/arrow_shot_voice.wav',
        hurtSfxPaths: [
            '../assets/sound/11_human_damage_1.wav',
            '../assets/sound/11_human_damage_2.wav'
        ],
        deathSfxPath: '../assets/sound/14_human_death_spin.wav',
        walkSfxPaths: [
            '../assets/sound/16_human_walk_stone_1.wav',
            '../assets/sound/16_human_walk_stone_2.wav',
            '../assets/sound/16_human_walk_stone_3.wav'
        ],
        orcAttackSfxPaths: [
            '../assets/sound/17_orc_atk_sword_1.wav',
            '../assets/sound/17_orc_atk_sword_2.wav',
            '../assets/sound/17_orc_atk_sword_3.wav'
        ],
        orcHurtSfxPaths: [
            '../assets/sound/21_orc_damage_1.wav',
            '../assets/sound/21_orc_damage_2.wav',
            '../assets/sound/21_orc_damage_3.wav'
        ],
        orcDeathSfxPath: '../assets/sound/24_orc_death_spin.wav',
        orcWalkSfxPaths: [
            '../assets/sound/25_orc_walk_stone_1.wav',
            '../assets/sound/25_orc_walk_stone_2.wav',
            '../assets/sound/25_orc_walk_stone_3.wav'
        ],
        attackSfxVolume: 0.45,
        bowAttackSfxVolume: 0.45,
        hurtSfxVolume: 0.42,
        deathSfxVolume: 0.5,
        walkSfxVolume: 0.3,
        walkSfxStepIntervalMs: 240,
        orcAttackSfxVolume: 0.36,
        orcHurtSfxVolume: 0.34,
        orcDeathSfxVolume: 0.42,
        orcWalkSfxVolume: 0.2,
        orcWalkSfxStepIntervalMs: 280,
        startupSafetyDurationMs: 2000,
        specialEventMode: 'cooldown',
        darknessRadius: 0,
        victoryOnBossDeath: false
    };

    const CANDLE_POSITIONS = [
        { x: 17, y: 9 },   // 北
        { x: 22, y: 14 },  // 东北
        { x: 27, y: 19 },  // 东
        { x: 22, y: 24 },  // 东南
        { x: 17, y: 29 },  // 南
        { x: 12, y: 24 },  // 西南
        { x: 7,  y: 19 },  // 西
        { x: 12, y: 14 }   // 西北
    ];

    const FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
    const FLIPPED_VERTICALLY_FLAG = 0x40000000;
    const FLIPPED_DIAGONALLY_FLAG = 0x20000000;
    const GID_CLEAR_FLAGS_MASK = ~(FLIPPED_HORIZONTALLY_FLAG | FLIPPED_VERTICALLY_FLAG | FLIPPED_DIAGONALLY_FLAG);

    function buildExitTarget(runToken) {
        let target = './index.html';
        if (runToken) {
            target += `?run=${encodeURIComponent(runToken)}`;
        }
        return new URL(target, window.location.href).href;
    }

    function startMapGame(userConfig) {
        const config = {
            ...DEFAULTS,
            ...userConfig
        };

        if (!config.tmxPath || !config.mapBgmSrc || !config.spawnTile || !config.eventTile || !config.specialEventTarget) {
            throw new Error('startMapGame 缺少必要配置项');
        }

        const canvas = document.getElementById('map-canvas');
        const ctx = canvas.getContext('2d');
        const mapWrap = document.getElementById('map-wrap');
        const soldierEl = document.getElementById('soldier');
        const enemyLayerEl = document.getElementById('enemy-layer');
        const arrowLayerEl = document.createElement('div');
        arrowLayerEl.className = 'arrow-layer';
        mapWrap.appendChild(arrowLayerEl);
        const statusEl = document.getElementById('status');
        const deathOverlayEl = document.getElementById('death-overlay');
        const reviveButtonEl = document.getElementById('revive-button');
        const exitButtonEl = document.getElementById('exit-button');
        const victoryOverlayEl = document.getElementById('victory-overlay');
        const victoryExitButtonEl = document.getElementById('victory-exit-button');
        const darknessOverlayEl = document.getElementById('darkness-overlay');
        const bgmList = Array.isArray(config.mapBgmSrc) ? config.mapBgmSrc : [config.mapBgmSrc];
        let currentBgmIndex = 0;
        const mapBgmAudio = new Audio(bgmList[currentBgmIndex]);
        mapBgmAudio.preload = 'auto';
        mapBgmAudio.volume = 0;

        if (bgmList.length === 1) {
            mapBgmAudio.loop = true;
        } else {
            mapBgmAudio.loop = false;
            mapBgmAudio.addEventListener('ended', async () => {
                if (mapBgmLeaving) return;
                
                currentBgmIndex = (currentBgmIndex + 1) % bgmList.length;
                mapBgmAudio.src = bgmList[currentBgmIndex];
                mapBgmAudio.currentTime = 0;
                
                try {
                    await mapBgmAudio.play();
                } catch (error) {
                    console.warn('[BGM] 轮播自动切歌失败:', error);
                }
            });
        }

        let cppRuntime = null;
        let mapBgmFadeTimer = null;
        let mapBgmLeaving = false;
        let specialEventCooldownUntilMs = 0;
        let specialEventArmed = false;
        let wasSoldierAttacking = false;
        let wasSoldierHurt = false;
        let wasSoldierDead = false;
        let wasSoldierWalking = false;
        let lastWalkSfxAt = 0;
        const enemyAudioStates = [];

        let deathOverlayVisible = false;
        let victoryOverlayVisible = false;
        let prevArcherBlessingActive = false;
        let extraArcherBlessingUntilMs = 0;
        let gameplayReady = false;
        let startupSafetyUntilMs = 0;
        let hasSeenPlayerAlive = false;
        let lastObservedHp = null;
        let deathByHpTransition = false;
        let wasPlayerActing = false;

        soldierEl.style.setProperty('--attack-duration', `${config.attackDurationMs}ms`);

        const ENEMY_SPAWNS = Array.isArray(config.enemySpawns) ? config.enemySpawns : [];
        const enemyEls = [];
        const arrowEls = [];

        const state = {
            width: 0,
            height: 0,
            tileWidth: config.tileSize,
            tileHeight: config.tileSize,
            gids: [],
            solidGids: new Set(),
            hasExplicitSolidData: false,
            tilesetFirstGid: 1,
            tilesetColumns: 0,
            tilesetTileCount: 0,
            tilesetImage: null,
            specialEventTriggered: false,
            viewportWidth: 0,
            viewportHeight: 0,
            lastTileX: config.spawnTile.x,
            lastTileY: config.spawnTile.y,
            lastStatusText: '',
            playerDeathShown: false,
            waveFx: {
                active: false,
                x: 0,
                y: 0,
                targetX: 0,
                targetY: 0,
                facingX: 1,
                facingY: 0,
                trail: []
            },
            arrowShots: {
                list: []
            },
            candleMechanic: {
            active: false,
            currentIndex: 0,
            turnsLeft: 5,
            lastTurnProcessed: -1
            },
            bossIgniteMechanic: {
            active: false,
            turnsLeft: 0,
            lastTurnProcessed: -1
            },
            bossWaveFx: {
            active: false, x: 0, y: 0, targetX: 0, targetY: 0, facingX: 1, facingY: 0, alpha: 0
            },
        };
        state.goblinKingSpawned = false;
        state.portalClosed = false;
        state.goblinKingDefeated = false;

        function showPlayerBubble(text, duration = 3600) {

            const oldBubble = soldierEl.querySelector('.thought-bubble');
            if (oldBubble) oldBubble.remove();

            console.log('[BUBBLE]', text);
        
            const bubble = document.createElement('div');
            bubble.className = 'thought-bubble';
            bubble.textContent = text;
            soldierEl.appendChild(bubble);
        
            setTimeout(() => {
                if (bubble.parentNode) bubble.remove();
            }, duration);
        }


        function updateDarkness() {
            if (!config.darknessRadius || !darknessOverlayEl) return;

            const px = cppRuntime.playerWorldX() - cppRuntime.cameraX();
            const py = cppRuntime.playerWorldY() - cppRuntime.cameraY() - (state.tileHeight * config.worldScale * 2);
            const radiusInPx = config.darknessRadius * state.tileWidth * config.worldScale;

            darknessOverlayEl.style.background = `radial-gradient(circle at ${px}px ${py}px, 
                rgba(0,0,0,0) 0%, 
                rgba(0,0,0,0.1) ${radiusInPx * 0.4}px, 
                rgba(0,0,0,0.96) ${radiusInPx}px, 
                #000000 ${radiusInPx * 1.2}px)`;
        }

        function clearMapBgmFadeTimer() {
            if (mapBgmFadeTimer) {
                clearInterval(mapBgmFadeTimer);
                mapBgmFadeTimer = null;
            }
        }

        function fadeMapBgm(targetVolume, onDone) {
            clearMapBgmFadeTimer();

            if (Math.abs(mapBgmAudio.volume - targetVolume) < 0.01) {
                mapBgmAudio.volume = targetVolume;
                if (onDone) onDone();
                return;
            }

            const stepTime = config.mapBgmFadeStepMs;
            const steps = Math.max(1, config.mapBgmFadeDurationMs / stepTime);
            const volumeStep = (targetVolume - mapBgmAudio.volume) / steps;

            mapBgmFadeTimer = setInterval(() => {
                const nextVolume = mapBgmAudio.volume + volumeStep;

                if ((volumeStep > 0 && nextVolume >= targetVolume) || (volumeStep < 0 && nextVolume <= targetVolume)) {
                    mapBgmAudio.volume = Math.max(0, Math.min(1, targetVolume));
                    clearMapBgmFadeTimer();
                    if (onDone) onDone();
                    return;
                }

                mapBgmAudio.volume = Math.max(0, Math.min(1, nextVolume));
            }, stepTime);
        }

        function bindMapBgmUnlock() {
            const unlock = () => {
                if (!mapBgmAudio.paused) return;
                void startMapBgm();
            };

            document.addEventListener('pointerdown', unlock, { once: true });
            document.addEventListener('keydown', unlock, { once: true });
        }

        async function startMapBgm() {
            if (mapBgmLeaving) return;

            try {
                if (mapBgmAudio.paused) {
                    mapBgmAudio.currentTime = 0;
                    mapBgmAudio.volume = 0;
                    await mapBgmAudio.play();
                    fadeMapBgm(config.mapBgmMaxVolume);
                }
            } catch (error) {
                console.warn('[BGM] 地图背景音乐播放被拦截，将等待首次交互后重试:', error);
                bindMapBgmUnlock();
            }
        }

        function stopMapBgmImmediate() {
            clearMapBgmFadeTimer();
            mapBgmAudio.pause();
            mapBgmAudio.currentTime = 0;
            mapBgmAudio.volume = 0;
        }

        function fadeOutMapBgmAndLeave(targetUrl) {
            if (mapBgmLeaving) return;
            mapBgmLeaving = true;
            exitButtonEl.disabled = true;
            reviveButtonEl.disabled = true;
            if (victoryExitButtonEl) victoryExitButtonEl.disabled = true;

            const leave = () => window.location.replace(targetUrl);

            if (mapBgmAudio.paused) {
                leave();
                return;
            }

            fadeMapBgm(0, () => {
                stopMapBgmImmediate();
                leave();
            });
        }

        function setDeathOverlayVisible(visible) {
            if (!deathOverlayEl) return;
            deathOverlayEl.hidden = !visible;
            deathOverlayVisible = visible;
        }

        function setVictoryOverlayVisible(visible) {
            if (!victoryOverlayEl) return;
            victoryOverlayEl.hidden = !visible;
            victoryOverlayVisible = visible;
        }

        function playOneShotSfx(path, volume) {
            const sfx = new Audio(path);
            sfx.volume = volume;

            sfx.play().catch((error) => {
                console.warn('[SFX] 音效播放失败:', error);
            });
        }

        function playRandomSfx(paths, volume) {
            if (!paths.length) return;
            const randomPath = paths[Math.floor(Math.random() * paths.length)];
            playOneShotSfx(randomPath, volume);
        }

        function playRandomAttackSfx() {
            playRandomSfx(config.attackSfxPaths, config.attackSfxVolume);
        }

        function getEnemyAudioState(index) {
            if (!enemyAudioStates[index]) {
                enemyAudioStates[index] = {
                    wasAttacking: false,
                    wasHurt: false,
                    wasDead: false,
                    wasWalking: false,
                    lastWalkSfxAt: 0,
                    lastWorldX: null,
                    lastWorldY: null
                };
            }
            return enemyAudioStates[index];
        }

        function parseCsvData(csvText) {
            return csvText
                .split(',')
                .map((v) => Number(v.trim()))
                .filter((v) => !Number.isNaN(v));
        }

        function isSolidProperty(value) {
            if (typeof value !== 'string') return false;
            const normalized = value.toLowerCase();
            return normalized === 'true' || normalized === '1' || normalized === 'yes';
        }

        function readTileSolidValue(tileNode) {
            const props = [...tileNode.querySelectorAll('property')];
            for (const prop of props) {
                const propName = (prop.getAttribute('name') || '').trim().toLowerCase();
                const propType = (prop.getAttribute('type') || '').trim().toLowerCase();
                const rawValue = prop.getAttribute('value') ?? prop.textContent ?? '';
                const value = String(rawValue).trim().toLowerCase();

                if (propName !== 'solid') continue;

                if (propType === 'bool' || propType === 'boolean') {
                    return value === 'true' || value === '1';
                }

                return isSolidProperty(value);
            }

            return null;
        }

        function loadImage(src) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
                img.src = src;
            });
        }

        async function loadTilesetData(tsxUrl, firstGid) {
            const set = new Set();

            try {
                const tsxText = await fetch(tsxUrl).then((r) => r.text());
                const tsxDoc = new DOMParser().parseFromString(tsxText, 'text/xml');
                const tilesetNode = tsxDoc.querySelector('tileset');
                const imageNode = tsxDoc.querySelector('image');

                if (!tilesetNode || !imageNode) {
                    throw new Error('TSX 缺少 tileset 或 image 节点');
                }

                const imageSource = imageNode.getAttribute('source');
                if (!imageSource) {
                    throw new Error('TSX image.source 为空');
                }

                const imageUrl = new URL(imageSource, tsxUrl).href;
                const image = await loadImage(imageUrl);

                state.tilesetFirstGid = firstGid;
                state.tilesetColumns = Number(tilesetNode.getAttribute('columns')) || 1;
                state.tilesetTileCount = Number(tilesetNode.getAttribute('tilecount')) || 0;
                state.tilesetImage = image;

                const tiles = [...tsxDoc.querySelectorAll('tile')];
                let explicitSolidCount = 0;

                tiles.forEach((tileNode) => {
                    const localId = Number(tileNode.getAttribute('id'));
                    const solidValue = readTileSolidValue(tileNode);

                    if (solidValue === null || Number.isNaN(localId)) return;

                    explicitSolidCount += 1;

                    if (solidValue === true) {
                        set.add(firstGid + localId);
                    }
                });

                state.hasExplicitSolidData = explicitSolidCount > 0;
            } catch (err) {
                console.warn('无法读取 TSX，solid 属性将退化为默认规则:', err);
            }

            return set;
        }

        function getGidAt(x, y) {
            const index = y * state.width + x;
            return state.gids[index] ?? 0;
        }

        function normalizeGid(gid) {
            return gid & GID_CLEAR_FLAGS_MASK;
        }

        function isSolidTileAt(x, y) {
            if (x < 0 || y < 0 || x >= state.width || y >= state.height) return true;
            const gid = normalizeGid(getGidAt(x, y));

            if (state.hasExplicitSolidData) return state.solidGids.has(gid);
            return gid === 0;
        }

        function setSoldierFacingByX(facingX) {
            soldierEl.style.setProperty('--facing-x', facingX < 0 ? '-1' : '1');
        }

        function setGoblinFacingByX(enemyEl, facingX) {
            enemyEl.style.setProperty('--facing-x', facingX < 0 ? '-1' : '1');
        }

        function tileToWorldPoint(tileX, tileY) {
            return {
                x: (tileX + 0.5) * state.tileWidth * config.worldScale,
                y: ((tileY + 1) * state.tileHeight - config.soldierFeetOffsetY) * config.worldScale
            };
        }

        function findArrowTargetTile(attackTiles) {
            let fallbackTile = null;
            for (let i = 0; i < attackTiles.length; i++) {
                const tile = attackTiles[i];
                fallbackTile = tile;

                if (isSolidTileAt(tile.x, tile.y + config.collisionTileOffsetY)) {
                    return tile;
                }

                const enemyCount = cppRuntime.enemyCount();
                for (let enemyIndex = 0; enemyIndex < enemyCount; enemyIndex++) {
                    if (cppRuntime.enemyIsRemovedAt(enemyIndex) || cppRuntime.enemyIsDeadAt(enemyIndex)) {
                        continue;
                    }
                    if (
                        cppRuntime.enemyTileXAt(enemyIndex) === tile.x
                        && cppRuntime.enemyTileYAt(enemyIndex) === tile.y
                    ) {
                        return tile;
                    }
                }
            }
            return fallbackTile;
        }

        function beginArrowShot(nowMs) {
            if (!cppRuntime) return;

            const isSmallSkill = cppRuntime.playerSmallSkillActive();
            const attackTiles = collectTileArea(
                () => cppRuntime.playerAttackAreaCount(),
                (index) => cppRuntime.playerAttackAreaX(index),
                (index) => cppRuntime.playerAttackAreaY(index)
            );
            if (!attackTiles.length) return;

            const gridOffset = 1.6 * config.worldScale * state.tileHeight;
            const startX = cppRuntime.playerWorldX();
            const startY = cppRuntime.playerWorldY() - config.soldierFrame * 0.44 - gridOffset;
            const facingX = cppRuntime.playerFacingX() < 0 ? -1 : 1;

            if (isSmallSkill) {
                const targetTile = attackTiles[attackTiles.length - 1]; 
                if (!targetTile) return;

                const targetWorld = tileToWorldPoint(targetTile.x, targetTile.y);
                const targetX = targetWorld.x;
                const targetY = targetWorld.y - config.soldierFrame * 0.44 - gridOffset;

                setTimeout(() => {
                    state.arrowShots.list.push({
                        startMs: performance.now(),
                        durationMs: Math.max(120, config.attackDurationMs * 0.5),
                        startX, startY, targetX, targetY, facingX,
                        isSmallSkill: true
                    });
                }, config.attackDurationMs * 0.8);
                return;
            }

            const targetTile = findArrowTargetTile(attackTiles);
            if (!targetTile) return;

            const targetWorld = tileToWorldPoint(targetTile.x, targetTile.y);
            const targetX = targetWorld.x;
            const targetY = targetWorld.y - config.soldierFrame * 0.44 - gridOffset;

            setTimeout(() => {
                state.arrowShots.list.push({
                    startMs: performance.now(),
                    durationMs: Math.max(80, config.attackDurationMs * 0.5),
                    startX, startY, targetX, targetY, facingX
                });
            }, config.attackDurationMs * 0.8);
        }

        function triggerEightWayArrows() {
            if (!cppRuntime) return;

            const gridOffset = 1.6 * config.worldScale * state.tileHeight;
            const currentTileX = cppRuntime.playerTileX();
            const currentTileY = cppRuntime.playerTileY();

            const dirs = [
                {x: -1, y: 0}, {x: 1, y: 0}, {x: 0, y: -1}, {x: 0, y: 1},
                {x: -1, y: -1}, {x: 1, y: -1}, {x: -1, y: 1}, {x: 1, y: 1}
            ];
            
            const maxRange = 10;

            const hasAliveEnemyAt = (x, y) => {
                const enemyCount = cppRuntime.enemyCount();
                for (let i = 0; i < enemyCount; i++) {
                    if (!cppRuntime.enemyIsRemovedAt(i) && !cppRuntime.enemyIsDeadAt(i)) {
                        if (cppRuntime.enemyTileXAt(i) === x && cppRuntime.enemyTileYAt(i) === y) {
                            return true;
                        }
                    }
                }
                return false;
            };

            const isBlocked = (x, y) => {
                return isSolidTileAt(x, y + config.collisionTileOffsetY);
            };

            dirs.forEach(initialDir => {
                let current = { x: currentTileX, y: currentTileY };
                let dir = { x: initialDir.x, y: initialDir.y };
                let turned = false;

                const tileSegments = [current];

                for (let travelled = 0; travelled < maxRange; travelled++) {
                    let next = { x: current.x + dir.x, y: current.y + dir.y };

                    if (isBlocked(next.x, next.y)) {
                        if (turned) break;

                        if (dir.x !== 0 && dir.y !== 0) {
                            const blockX = isBlocked(current.x + dir.x, current.y);
                            const blockY = isBlocked(current.x, current.y + dir.y);
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
                        next = { x: current.x + dir.x, y: current.y + dir.y };
                        if (isBlocked(next.x, next.y)) {
                            break;
                        }
                    }

                    current = next;
                    tileSegments.push(current);

                    if (hasAliveEnemyAt(current.x, current.y)) {
                        break;
                    }
                }

                if (tileSegments.length > 1) {

                    const worldSegments = tileSegments.map(t => {
                        const tw = tileToWorldPoint(t.x, t.y);
                        return {
                            x: tw.x,
                            y: tw.y - config.soldierFrame * 0.44 - gridOffset
                        };
                    });

                    const speedPerTileMs = 28; 
                    const durationMs = Math.max(120, (tileSegments.length - 1) * speedPerTileMs);

                    state.arrowShots.list.push({
                        startMs: performance.now(),
                        durationMs: durationMs,
                        startX: worldSegments[0].x,
                        startY: worldSegments[0].y,
                        targetX: worldSegments[worldSegments.length - 1].x,
                        targetY: worldSegments[worldSegments.length - 1].y,
                        segments: worldSegments,
                        isBigSkillVolley: true 
                    });
                }
            });

            playOneShotSfx(config.bowAttackSfxPaths, config.bowAttackSfxVolume * 0.8);
        }

        function ensureArrowElements(count) {
            while (arrowEls.length < count) {
                const el = document.createElement('div');
                el.className = 'arrow-projectile sprite-hidden';
                arrowLayerEl.appendChild(el);
                arrowEls.push(el);
            }

            for (let i = 0; i < arrowEls.length; i++) {
                arrowEls[i].classList.toggle('sprite-hidden', i >= count);
            }
        }

        function updateArrowProjectiles(nowMs) {
            state.arrowShots.list = state.arrowShots.list.filter((shot) => nowMs - shot.startMs <= shot.durationMs);

            ensureArrowElements(state.arrowShots.list.length);
            if (!state.arrowShots.list.length) return;

            const cameraX = cppRuntime.cameraX();
            const cameraY = cppRuntime.cameraY();

            for (let i = 0; i < state.arrowShots.list.length; i++) {
                const shot = state.arrowShots.list[i];
                const el = arrowEls[i];
                const progress = Math.max(0, Math.min(1, (nowMs - shot.startMs) / shot.durationMs));
                
                let x, y, angle;
                
                if (shot.segments && shot.segments.length > 1) {
                    const totalSegments = shot.segments.length - 1;
                    const scaledProgress = progress * totalSegments;
                    const segmentIndex = Math.min(Math.floor(scaledProgress), totalSegments - 1);
                    const segmentProgress = scaledProgress - segmentIndex;
                    
                    const p1 = shot.segments[segmentIndex];
                    const p2 = shot.segments[segmentIndex + 1];
                    
                    x = p1.x + (p2.x - p1.x) * segmentProgress;
                    y = p1.y + (p2.y - p1.y) * segmentProgress;
                    angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
                } else {
                    x = shot.startX + (shot.targetX - shot.startX) * progress;
                    y = shot.startY + (shot.targetY - shot.startY) * progress;
                    angle = Math.atan2(shot.targetY - shot.startY, shot.targetX - shot.startX) * 180 / Math.PI;
                }

                el.style.left = `${x - cameraX - 50}px`;
                el.style.top = `${y - cameraY - 50}px`;
                el.style.opacity = `${1 - progress * 0.15}`;
                el.style.transform = `rotate(${angle}deg) scale(2, 2)`;
                
                if (shot.isBigSkillVolley) {
                    el.style.filter = 'drop-shadow(0 0 6px #ffd659) drop-shadow(0 0 12px #ffaa00) brightness(1.5)';
                } else if (shot.isSmallSkill) {
                    el.style.filter = 'drop-shadow(0 0 8px white) drop-shadow(0 0 16px white) brightness(2)';
                } else if (shot.isBossSkill) {
                    el.style.filter = 'drop-shadow(0 0 8px #ff0000) drop-shadow(0 0 16px #880000) brightness(1.5)';
                }else {
                    el.style.filter = 'none';
                }
            }
        }

        function requestAttack() {
            if (!cppRuntime || !gameplayReady || deathOverlayVisible || victoryOverlayVisible || isPlayerDeadState()) return;
            cppRuntime.requestAttack(performance.now());
        }

        function requestSmallSkill() {
            if (!cppRuntime || !gameplayReady || deathOverlayVisible || victoryOverlayVisible || isPlayerDeadState()) return;
            cppRuntime.requestSmallSkill(performance.now());
        }

        function requestBigSkill() {
            if (!cppRuntime || !gameplayReady || deathOverlayVisible || victoryOverlayVisible || isPlayerDeadState()) return;
            cppRuntime.requestBigSkill(performance.now());
        }

        function isPlayerDeadState() {
            if (!cppRuntime || !gameplayReady) return false;
            const hp = cppRuntime.playerCurrentHp();
            const deadFlag = cppRuntime.playerIsDead();
            return deadFlag && hp <= 0;
        }

        function updateSoldierAnimation() {
            const isDead = isPlayerDeadState();
            const deathFinished = cppRuntime.playerDeathFinished();
            const isHurt = !isDead && cppRuntime.playerIsHurt();
            const isAttacking = !isDead && !isHurt && cppRuntime.playerIsAttacking();
            const attackVariant = isAttacking ? cppRuntime.playerAttackVariant() : 0;
            const isWalking = !isDead && !isHurt && !isAttacking && cppRuntime.playerIsWalking();
            const isActing = isAttacking || cppRuntime.playerIsMoving();
            if (wasPlayerActing && !isActing) {
                if (cppRuntime.playerArcherBlessingActive()) {
                    triggerEightWayArrows();
                }
            }
            wasPlayerActing = isActing;
            const smallSkillActive = cppRuntime.playerSmallSkillActive();
            const archerBlessingActive = cppRuntime.playerArcherBlessingActive();
            const nowMs = performance.now();
            const extraBlessingMs = Math.max(200, config.attackDurationMs + config.moveDurationMs);
            if (prevArcherBlessingActive && !archerBlessingActive) {
                try {
                    triggerEightWayArrows();
                } catch (err) {
                    console.warn('triggerEightWayArrows failed on end-transition:', err);
                }
                extraArcherBlessingUntilMs = nowMs + extraBlessingMs;
            }
            const showArcherBlessing = archerBlessingActive || nowMs < extraArcherBlessingUntilMs;

            const showAttack01 = isAttacking && attackVariant === 1;
            const showAttack02 = isAttacking && attackVariant === 2;
            const showAttack03 = isAttacking && attackVariant === 3;

            soldierEl.classList.toggle('is-hurt', isHurt);
            soldierEl.classList.toggle('is-dead', isDead);
            soldierEl.classList.toggle('is-attacking-1', showAttack01);
            soldierEl.classList.toggle('is-attacking-2', showAttack02);
            soldierEl.classList.toggle('is-attacking-3', showAttack03);
            soldierEl.classList.toggle('is-walking', isWalking);
            soldierEl.classList.toggle('is-idle', !isAttacking && !isWalking);
            soldierEl.classList.toggle('is-small-skill-active', smallSkillActive);
            soldierEl.classList.toggle('is-archer-blessing-active', showArcherBlessing);
            soldierEl.classList.toggle('sprite-hidden', isDead && deathFinished);

            if (isAttacking && !wasSoldierAttacking) {
                if (attackVariant === 3) {
                    beginArrowShot(performance.now());
                    playOneShotSfx(config.bowAttackSfxPaths, config.bowAttackSfxVolume);
                } else {
                    playRandomAttackSfx();
                }
            }

            if (isHurt && !wasSoldierHurt) {
                playRandomSfx(config.hurtSfxPaths, config.hurtSfxVolume);
            }

            if (isDead && !wasSoldierDead) {
                playOneShotSfx(config.deathSfxPath, config.deathSfxVolume);
            }

            if (isWalking) {
                const now = performance.now();
                if (!wasSoldierWalking || now - lastWalkSfxAt >= config.walkSfxStepIntervalMs) {
                    playRandomSfx(config.walkSfxPaths, config.walkSfxVolume);
                    lastWalkSfxAt = now;
                }
            } else {
                lastWalkSfxAt = 0;
            }

            wasSoldierAttacking = isAttacking;
            prevArcherBlessingActive = archerBlessingActive;
            wasSoldierHurt = isHurt;
            wasSoldierDead = isDead;
            wasSoldierWalking = isWalking;
        }

        function ensureEnemyElements(count) {
            while (enemyEls.length < count) {
                const el = document.createElement('div');
                el.className = 'goblin is-idle';
                el.style.setProperty('--attack-duration', `${config.goblinAttackDurationMs}ms`);
                enemyLayerEl.appendChild(el);
                enemyEls.push(el);
            }

            for (let i = 0; i < enemyEls.length; i++) {
                enemyEls[i].classList.toggle('sprite-hidden', i >= count);
            }
        }

        function updateEnemyAnimationAt(enemyEl, index, worldX, worldY, now) {
            const isRemoved = cppRuntime.enemyIsRemovedAt(index);
            const isDead = !isRemoved && cppRuntime.enemyIsDeadAt(index);
            const isHurt = !isRemoved && !isDead && cppRuntime.enemyIsHurtAt(index);
            const isAttacking = !isRemoved && !isDead && !isHurt && cppRuntime.enemyIsAttackingAt(index);
            const attackVariant = isAttacking ? cppRuntime.enemyAttackVariantAt(index) : 0;
            const discovered = cppRuntime.enemyIsDiscoveredAt(index);
            const audioState = getEnemyAudioState(index);

            const hasLastPos = audioState.lastWorldX !== null && audioState.lastWorldY !== null;
            const movedDistance = hasLastPos
                ? Math.hypot(worldX - audioState.lastWorldX, worldY - audioState.lastWorldY)
                : 0;
            const isWalking = !isRemoved && !isDead && !isHurt && !isAttacking && movedDistance > 0.1;

            enemyEl.classList.toggle('is-hurt', isHurt);
            enemyEl.classList.toggle('is-dead', isDead);
            enemyEl.classList.toggle('is-attacking-1', isAttacking && attackVariant === 1);
            enemyEl.classList.toggle('is-attacking-2', isAttacking && attackVariant === 2);
            enemyEl.classList.toggle('is-idle', !isAttacking);
            enemyEl.classList.toggle('is-discovered', discovered);
            enemyEl.classList.toggle('sprite-hidden', isRemoved);

            if (isRemoved) {
                audioState.wasAttacking = false;
                audioState.wasHurt = false;
                audioState.wasDead = false;
                audioState.wasWalking = false;
                audioState.lastWalkSfxAt = 0;
                audioState.lastWorldX = worldX;
                audioState.lastWorldY = worldY;
                return;
            }

            if (isAttacking && !audioState.wasAttacking) {
                playRandomSfx(config.orcAttackSfxPaths, config.orcAttackSfxVolume);
            }

            if (isHurt && !audioState.wasHurt) {
                playRandomSfx(config.orcHurtSfxPaths, config.orcHurtSfxVolume);
            }

            if (isDead && !audioState.wasDead) {
                playOneShotSfx(config.orcDeathSfxPath, config.orcDeathSfxVolume);
            }

            if (isWalking) {
                if (!audioState.wasWalking || now - audioState.lastWalkSfxAt >= config.orcWalkSfxStepIntervalMs) {
                    playRandomSfx(config.orcWalkSfxPaths, config.orcWalkSfxVolume);
                    audioState.lastWalkSfxAt = now;
                }
            } else {
                audioState.lastWalkSfxAt = 0;
            }

            audioState.wasAttacking = isAttacking;
            audioState.wasHurt = isHurt;
            audioState.wasDead = isDead;
            audioState.wasWalking = isWalking;
            audioState.lastWorldX = worldX;
            audioState.lastWorldY = worldY;
        }

        function collectTileArea(countGetter, xGetter, yGetter) {
            const count = countGetter();
            const area = [];
            for (let i = 0; i < count; i++) {
                area.push({ x: xGetter(i), y: yGetter(i) });
            }
            return area;
        }

        function drawTileHighlights(tiles, fillStyle, strokeStyle) {
            if (!tiles.length) return;

            const tileRenderWidth = state.tileWidth * config.worldScale;
            const tileRenderHeight = state.tileHeight * config.worldScale;
            const cameraX = cppRuntime.cameraX();
            const cameraY = cppRuntime.cameraY();

            ctx.save();
            ctx.fillStyle = fillStyle;
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = 1;

            for (const tile of tiles) {
                if (tile.x < 0 || tile.y < 0 || tile.x >= state.width || tile.y >= state.height) continue;

                const px = tile.x * tileRenderWidth - cameraX;
                const py = tile.y * tileRenderHeight - cameraY;
                ctx.fillRect(px, py, tileRenderWidth, tileRenderHeight);
                ctx.strokeRect(px + 0.5, py + 0.5, tileRenderWidth - 1, tileRenderHeight - 1);
            }

            ctx.restore();
        }

        function drawBigWaveArcEffect(waveTiles) {
            function drawArc(x, y, facingX, facingY, alpha, scale = 1) {
                const major = Math.max(tileRenderWidth, tileRenderHeight) * 1.18 * scale;
                const minor = Math.min(tileRenderWidth, tileRenderHeight) * 1.04 * scale;

                ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
                ctx.lineWidth = 3 * scale;
                ctx.beginPath();
                if (facingX !== 0) {
                    ctx.moveTo(x, y - major * 0.5);
                    ctx.quadraticCurveTo(x + minor * facingX, y, x, y + major * 0.5);
                } else {
                    ctx.moveTo(x - major * 0.5, y);
                    ctx.quadraticCurveTo(x, y + minor * facingY, x + major * 0.5, y);
                }
                ctx.stroke();
            }

            const tileRenderWidth = state.tileWidth * config.worldScale;
            const tileRenderHeight = state.tileHeight * config.worldScale;

            if (!waveTiles.length) {
                state.waveFx.active = false;
                if (!state.waveFx.trail.length) return;

                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                for (const item of state.waveFx.trail) {
                    item.alpha *= 0.82;
                    drawArc(item.x, item.y, item.facingX, item.facingY, item.alpha, item.scale);
                }
                ctx.restore();

                state.waveFx.trail = state.waveFx.trail
                    .filter((item) => item.alpha > 0.035)
                    .map((item) => ({ ...item, scale: item.scale * 0.985 }));
                return;
            }

            const cameraX = cppRuntime.cameraX();
            const cameraY = cppRuntime.cameraY();

            let sumX = 0;
            let sumY = 0;
            let minX = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            let maxY = Number.NEGATIVE_INFINITY;

            for (const tile of waveTiles) {
                const cx = (tile.x + 0.5) * tileRenderWidth - cameraX;
                const cy = (tile.y + 0.5) * tileRenderHeight - cameraY;
                sumX += cx;
                sumY += cy;
                minX = Math.min(minX, tile.x);
                maxX = Math.max(maxX, tile.x);
                minY = Math.min(minY, tile.y);
                maxY = Math.max(maxY, tile.y);
            }

            const targetX = sumX / waveTiles.length;
            const targetY = sumY / waveTiles.length;

            state.waveFx.targetX = targetX;
            state.waveFx.targetY = targetY;

            if (!state.waveFx.active) {
                state.waveFx.active = true;
                state.waveFx.x = targetX;
                state.waveFx.y = targetY;
            } else {
                const smoothing = 0.18;
                state.waveFx.x += (targetX - state.waveFx.x) * smoothing;
                state.waveFx.y += (targetY - state.waveFx.y) * smoothing;
            }

            let countMinX = 0;
            let countMaxX = 0;
            let countMinY = 0;
            let countMaxY = 0;
            for (const tile of waveTiles) {
                if (tile.x === minX) countMinX += 1;
                if (tile.x === maxX) countMaxX += 1;
                if (tile.y === minY) countMinY += 1;
                if (tile.y === maxY) countMaxY += 1;
            }

            let facingX = 0;
            let facingY = 0;
            if (countMaxX === 1 && countMinX > 1) {
                facingX = 1;
            } else if (countMinX === 1 && countMaxX > 1) {
                facingX = -1;
            } else if (countMaxY === 1 && countMinY > 1) {
                facingY = 1;
            } else {
                facingY = -1;
            }

            state.waveFx.facingX = facingX;
            state.waveFx.facingY = facingY;

            ctx.save();
            ctx.globalCompositeOperation = 'lighter';

            if (state.waveFx.trail.length > 0) {
                for (const item of state.waveFx.trail) {
                    item.alpha *= 0.86;
                    drawArc(item.x, item.y, item.facingX, item.facingY, item.alpha, item.scale);
                }
            }

            drawArc(state.waveFx.x, state.waveFx.y, facingX, facingY, 0.95, 1.0);

            state.waveFx.trail.push({
                x: state.waveFx.x,
                y: state.waveFx.y,
                facingX,
                facingY,
                alpha: 0.36,
                scale: 0.92
            });

            if (state.waveFx.trail.length > 8) {
                state.waveFx.trail.splice(0, state.waveFx.trail.length - 8);
            }

            state.waveFx.trail = state.waveFx.trail
                .filter((item) => item.alpha > 0.035)
                .map((item) => ({ ...item, scale: item.scale * 0.99 }));

            ctx.restore();
        }

        function getWorldWidth() {
            return state.width * state.tileWidth * config.worldScale;
        }

        function getWorldHeight() {
            return state.height * state.tileHeight * config.worldScale;
        }

        function resizeViewport() {
            const desiredWidth = Math.floor(window.innerWidth - config.viewportMarginX);
            const desiredHeight = Math.floor(window.innerHeight - config.viewportMarginY);
            const worldWidth = getWorldWidth();
            const worldHeight = getWorldHeight();

            state.viewportWidth = Math.max(1, Math.min(desiredWidth, worldWidth));
            state.viewportHeight = Math.max(1, Math.min(desiredHeight, worldHeight));
            canvas.width = state.viewportWidth;
            canvas.height = state.viewportHeight;
            mapWrap.style.width = `${state.viewportWidth}px`;
            mapWrap.style.height = `${state.viewportHeight}px`;

            if (cppRuntime) {
                cppRuntime.setViewport(state.viewportWidth, state.viewportHeight);
            }
        }

        function triggerSpecialEvent(eventConfig) {
            const query = new URLSearchParams(window.location.search);
            const runToken = query.get('run');
            const sessionToken = query.get('session');
            const role = query.get('role');
            const params = [];

            if (runToken) params.push(`run=${encodeURIComponent(runToken)}`);
            if (sessionToken) params.push(`session=${encodeURIComponent(sessionToken)}`);
            if (role) params.push(`role=${encodeURIComponent(role)}`);
            if (eventConfig.entryTag) {
                params.push(`entry=${encodeURIComponent(eventConfig.entryTag)}`);
            }
        
            let target = eventConfig.target;
            if (params.length > 0) {
                target += (target.includes('?') ? '&' : '?') + params.join('&');
            }
        
            fadeOutMapBgmAndLeave(target);
        }

        function checkSpecialEvent() {
            if (state.specialEventTriggered) return;

            const playerTileX = cppRuntime.playerTileX();
            const playerTileY = cppRuntime.playerTileY();
            const now = performance.now();
            const hasKey = sessionStorage.getItem('yz_map03_key') === 'true';
            if (config.mapFileName === 'map02.html' && playerTileX === 5 && playerTileY === 19 && !hasKey) {
                console.log('[EVENT] 获取钥匙触发', { x: playerTileX, y: playerTileY });
                sessionStorage.setItem('yz_map03_key', 'true');
                showPlayerBubble("宝箱里竟然有钥匙，可能是通往某处的关键");
                return;
            }
            const portals = config.portals || [];
            for (const portal of portals) {
                if (playerTileX === portal.tile.x && playerTileY === portal.tile.y) {
                    if (portal.requireKey && !hasKey) {
                        console.log('[EVENT] 门锁提示触发', { x: playerTileX, y: playerTileY, portal });
                        if (!state.lastKeyHintAt || now - state.lastKeyHintAt > 2800) {
                            showPlayerBubble("门锁着，似乎需要某种钥匙...");
                            state.lastKeyHintAt = now;
                        }
                        return;
                    }

                    if (config.specialEventMode === 'armed' && !specialEventArmed) {
                        continue; 
                    }
                    state.specialEventTriggered = true;
                    triggerSpecialEvent(portal);
                    return;
                }
            }
            if (config.mapFileName === 'map03.html' && state.portalClosed) {
                if (playerTileX === config.eventTile.x && playerTileY === config.eventTile.y) {
                    if (!state.lastKeyHintAt || now - state.lastKeyHintAt > 2800) {
                        showPlayerBubble("好凶的哥布林！而且回去的路好像被堵上了……", 4200);
                        state.lastKeyHintAt = now;
                    }
                    return;
                }
            }

            const reachedDefaultEvent = playerTileX === config.eventTile.x && playerTileY === config.eventTile.y;
            if (reachedDefaultEvent) {
                if (config.specialEventMode === 'armed' && !specialEventArmed) return;
                state.specialEventTriggered = true;
                triggerSpecialEvent({
                    target: config.specialEventTarget,
                    entryTag: config.specialEventEntryTag
                });
                return;
            }
            specialEventArmed = true;
        }

        function drawMap() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const tileRenderWidth = state.tileWidth * config.worldScale;
            const tileRenderHeight = state.tileHeight * config.worldScale;
            const cameraX = cppRuntime.cameraX();
            const cameraY = cppRuntime.cameraY();
            const startX = Math.max(0, Math.floor(cameraX / tileRenderWidth));
            const startY = Math.max(0, Math.floor(cameraY / tileRenderHeight));
            const endX = Math.min(state.width, Math.ceil((cameraX + state.viewportWidth) / tileRenderWidth) + 1);
            const endY = Math.min(state.height, Math.ceil((cameraY + state.viewportHeight) / tileRenderHeight) + 1);

            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const gid = normalizeGid(getGidAt(x, y));
                    if (gid === 0 || !state.tilesetImage) {
                        continue;
                    }

                    const localId = gid - state.tilesetFirstGid;
                    if (localId < 0) continue;
                    if (state.tilesetTileCount > 0 && localId >= state.tilesetTileCount) continue;

                    const srcX = (localId % state.tilesetColumns) * state.tileWidth;
                    const srcY = Math.floor(localId / state.tilesetColumns) * state.tileHeight;

                    ctx.drawImage(
                        state.tilesetImage,
                        srcX,
                        srcY,
                        state.tileWidth,
                        state.tileHeight,
                        x * tileRenderWidth - cameraX,
                        y * tileRenderHeight - cameraY,
                        tileRenderWidth,
                        tileRenderHeight
                    );
                }
            }

            const waveTiles = collectTileArea(
                () => cppRuntime.playerBigWaveAreaCount(),
                (index) => cppRuntime.playerBigWaveAreaX(index),
                (index) => cppRuntime.playerBigWaveAreaY(index)
            ).map((tile) => ({
                x: tile.x,
                y: tile.y - 2
            }));
            drawTileHighlights(waveTiles, 'rgba(255, 255, 255, 0.06)', 'rgba(255, 255, 255, 0.22)');
            drawBigWaveArcEffect(waveTiles);

            const attackTiles = collectTileArea(
                () => cppRuntime.playerAttackAreaCount(),
                (index) => cppRuntime.playerAttackAreaX(index),
                (index) => cppRuntime.playerAttackAreaY(index)
            );
            if (attackTiles.length > 0) {
                if (cppRuntime.playerSmallSkillActive()) {
                    const smallSkillTiles = attackTiles.map((tile) => ({ x: tile.x, y: tile.y - 2 }));
                    drawTileHighlights(smallSkillTiles, 'rgba(255, 255, 255, 0.2)', 'rgba(255, 255, 255, 0.2)');
                } else {
                    const normalAttackTiles = attackTiles.map((tile) => ({ x: tile.x, y: tile.y - 2 }));
                    drawTileHighlights(normalAttackTiles, 'rgba(255, 255, 255, 0.22)', 'rgba(255, 255, 255, 0.68)');
                }
            }

            const enemyAttackTiles = [];
            const enemyCount = cppRuntime.enemyCount();
            for (let enemyIndex = 0; enemyIndex < enemyCount; enemyIndex++) {
                const enemyTiles = collectTileArea(
                    () => cppRuntime.enemyAttackAreaCountAt(enemyIndex),
                    (tileIndex) => cppRuntime.enemyAttackAreaXAt(enemyIndex, tileIndex),
                    (tileIndex) => cppRuntime.enemyAttackAreaYAt(enemyIndex, tileIndex)
                );
                for (let i = 0; i < enemyTiles.length; i++) {
                    enemyAttackTiles.push({
                        x: enemyTiles[i].x,
                        y: enemyTiles[i].y + config.goblinAttackHighlightOffsetY
                    });
                }
            }
            drawTileHighlights(enemyAttackTiles, 'rgba(255, 92, 92, 0.16)', 'rgba(255, 116, 116, 0.6)');

            if (state.candleMechanic && state.candleMechanic.active) {
                const candle = CANDLE_POSITIONS[state.candleMechanic.currentIndex];
                const areaTiles = [];
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        areaTiles.push({ x: candle.x + dx, y: candle.y + dy - 2 }); 
                    }
                }
                drawTileHighlights(areaTiles, 'rgba(50, 255, 50, 0.25)', 'rgba(50, 255, 50, 0.6)');

                const tileRenderWidth = state.tileWidth * config.worldScale;
                const tileRenderHeight = state.tileHeight * config.worldScale;
                const cameraX = cppRuntime.cameraX();
                const cameraY = cppRuntime.cameraY();
                const cx = (candle.x + 0.5) * tileRenderWidth - cameraX;
                const cy = (candle.y - 1.5) * tileRenderHeight - cameraY;

                ctx.save();
                ctx.fillStyle = '#64ff64';
                ctx.font = 'bold 16px sans-serif';
                ctx.textAlign = 'center';
                ctx.shadowColor = '#000';
                ctx.shadowBlur = 4;
                ctx.fillText(`${state.candleMechanic.turnsLeft} 回合`, cx, cy);
                ctx.restore();
            }

            if (state.bossIgniteMechanic && state.bossIgniteMechanic.active) {
                const igniteTiles = [];
                for (const candle of CANDLE_POSITIONS) {
                    for (let dy = -2; dy <= 2; dy++) {
                        for (let dx = -2; dx <= 2; dx++) {
                            igniteTiles.push({ x: candle.x + dx, y: candle.y + dy - 2 });
                        }
                    }
                }
                drawTileHighlights(igniteTiles, 'rgba(255, 30, 0, 0.2)', 'rgba(255, 30, 0, 0.4)');
            }

            if (state.bossWaveFx && state.bossWaveFx.active) {
                state.bossWaveFx.x += (state.bossWaveFx.targetX - state.bossWaveFx.x) * 0.15;
                state.bossWaveFx.y += (state.bossWaveFx.targetY - state.bossWaveFx.y) * 0.15;
                state.bossWaveFx.alpha -= 0.04;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.strokeStyle = `rgba(255, 40, 40, ${Math.max(0, state.bossWaveFx.alpha)})`;
                ctx.lineWidth = 5;
                ctx.beginPath();
                const major = 64, minor = 42;
                const bx = state.bossWaveFx.x - cppRuntime.cameraX();
                const by = state.bossWaveFx.y - cppRuntime.cameraY() - config.soldierFrame * 0.44;

                if (state.bossWaveFx.facingX !== 0) {
                    ctx.moveTo(bx, by - major * 0.5);
                    ctx.quadraticCurveTo(bx + minor * state.bossWaveFx.facingX, by, bx, by + major * 0.5);
                } else {
                    ctx.moveTo(bx - major * 0.5, by);
                    ctx.quadraticCurveTo(bx, by + minor * state.bossWaveFx.facingY, bx + major * 0.5, by);
                }
                ctx.stroke();
                ctx.restore();

                if (state.bossWaveFx.alpha <= 0) state.bossWaveFx.active = false;
            }
        }

        function updateSoldierPosition() {
            const px = cppRuntime.playerWorldX();
            const py = cppRuntime.playerWorldY();
            const cameraX = cppRuntime.cameraX();
            const cameraY = cppRuntime.cameraY();

            soldierEl.style.left = `${px - cameraX - config.soldierFrame / 2}px`;
            soldierEl.style.top = `${py - cameraY - config.soldierFrame}px`;
            setSoldierFacingByX(cppRuntime.playerFacingX());
            updateSoldierAnimation();
        }

        function updateEnemyPositions() {
            const enemyCount = cppRuntime.enemyCount();
            ensureEnemyElements(enemyCount);

            const cameraX = cppRuntime.cameraX();
            const cameraY = cppRuntime.cameraY();
            const now = performance.now();
            for (let i = 0; i < enemyCount; i++) {
                const enemyEl = enemyEls[i];
                const px = cppRuntime.enemyWorldXAt(i);
                const py = cppRuntime.enemyWorldYAt(i);

                enemyEl.style.left = `${px - cameraX - config.goblinFrame / 2}px`;
                enemyEl.style.top = `${py - cameraY - config.goblinFrame}px`;
                setGoblinFacingByX(enemyEl, cppRuntime.enemyFacingXAt(i));
                try {
                    if (typeof cppRuntime.enemyRoleKindAt === 'function') {
                        const rk = cppRuntime.enemyRoleKindAt(i);
                        enemyEl.classList.toggle('is-king', rk === 1);
                    }
                } catch (err) {
                    // ignore
                }

                updateEnemyAnimationAt(enemyEl, i, px, py, now);
            }
        }

        function movePlayer(dx, dy) {
            if (!cppRuntime || !gameplayReady || deathOverlayVisible || victoryOverlayVisible || isPlayerDeadState()) return;
            cppRuntime.requestMove(dx, dy, performance.now());
        }

        function updatePositionText() {
            const currentX = cppRuntime.playerTileX();
            const currentY = cppRuntime.playerTileY();

            const playerHp = cppRuntime.playerCurrentHp();

            if (playerHp > 0) {
                sessionStorage.setItem('yz_global_hp', playerHp);
            }

            const playerMaxHp = cppRuntime.playerMaxHp();
            const playerDead = isPlayerDeadState();
            const playerHurt = cppRuntime.playerIsHurt();
            const baseAttack = cppRuntime.playerAttackPower();
            const attackPercent = cppRuntime.playerAttackPowerPercent();
            const currentAttack = Math.floor(baseAttack * attackPercent / 100);
            const smallActive = cppRuntime.playerSmallSkillActive();
            const autoLock = cppRuntime.playerAutoLockEnabled();
            const smallLeft = cppRuntime.playerSmallSkillTurnsLeft();
            const smallCd = cppRuntime.playerSmallSkillCooldownLeft();
            const bigCd = cppRuntime.playerBigSkillCooldownLeft();
            const waveActive = cppRuntime.playerBigWaveActive();
            const archerBlessingActive = cppRuntime.playerArcherBlessingActive();
            const playerState = playerDead ? '阵亡' : playerHurt ? '受击' : '行动中';
            const enemyCount = cppRuntime.enemyCount();
            const enemyName = cppRuntime.enemyRoleName();
            const enemyAtk = cppRuntime.enemyAttackPower();
            const enemyMaxHp = cppRuntime.enemyMaxHp();

            let aliveEnemies = 0;
            let discoveredEnemies = 0;
            let removedEnemies = 0;
            let totalEnemyHp = 0;
            for (let i = 0; i < enemyCount; i++) {
                if (cppRuntime.enemyIsRemovedAt(i)) {
                    removedEnemies++;
                    continue;
                }

                totalEnemyHp += Math.max(0, cppRuntime.enemyCurrentHpAt(i));
                if (!cppRuntime.enemyIsDeadAt(i)) {
                    aliveEnemies++;
                }
                if (cppRuntime.enemyIsDiscoveredAt(i)) {
                    discoveredEnemies++;
                }
            }

            const activeEnemies = Math.max(0, enemyCount - removedEnemies);
            const enemyStateSummary = `存活${aliveEnemies}/${activeEnemies} 发现${discoveredEnemies}/${activeEnemies}`;

            const waveLabel = waveActive ? ' | 剑气推进中' : '';
            const archerBuffLabel = archerBlessingActive ? ' | 白光祝福生效中' : '';
            const text = `${cppRuntime.playerRoleName()} | HP ${playerHp}/${playerMaxHp} | 状态:${playerState} | ATK ${currentAttack}(${attackPercent}%) | 锁敌:${autoLock ? '开' : '关'} | 小技能:${smallActive ? `持续${smallLeft}` : '未激活'}/CD${smallCd} | 大技能CD${bigCd}${waveLabel}${archerBuffLabel} | ${enemyName}x${enemyCount}: HP总量 ${totalEnemyHp}/${enemyMaxHp * activeEnemies} ATK ${enemyAtk} ${enemyStateSummary} | 当前位置: (${currentX}, ${currentY})`;

            if (text === state.lastStatusText && currentX === state.lastTileX && currentY === state.lastTileY) return;

            state.lastTileX = currentX;
            state.lastTileY = currentY;
            state.lastStatusText = text;
            statusEl.textContent = text;
        }

        function syncDeathOverlay() {
            if (!cppRuntime || !gameplayReady) return;

            const now = performance.now();
            if (now < startupSafetyUntilMs) {
                setDeathOverlayVisible(false);
                state.playerDeathShown = false;
                return;
            }

            const playerDead = isPlayerDeadState();
            const deathFinished = cppRuntime.playerDeathFinished();

            if (!playerDead) {
                setDeathOverlayVisible(false);
                state.playerDeathShown = false;
                return;
            }

            if (!deathByHpTransition) {
                return;
            }

            if (playerDead && deathFinished) {
                setDeathOverlayVisible(true);
                state.playerDeathShown = true;
            }
        }

        function syncVictoryOverlay() {
            if (!config.victoryOnBossDeath || !cppRuntime || !gameplayReady || !victoryOverlayEl) return;

            const now = performance.now();
            if (now < startupSafetyUntilMs || isPlayerDeadState()) {
                setVictoryOverlayVisible(false);
                return;
            }

            if (deathOverlayVisible) {
                setVictoryOverlayVisible(false);
                return;
            }

            if (state.goblinKingDefeated) {
                setVictoryOverlayVisible(true);
                return;
            }

            let bossFound = false;
            let bossAlive = false;
            const enemyCount = cppRuntime.enemyCount();
            for (let i = 0; i < enemyCount; i++) {
                if (cppRuntime.enemyRoleKindAt && cppRuntime.enemyRoleKindAt(i) === 1) {
                    bossFound = true;
                    if (!cppRuntime.enemyIsDeadAt(i) && !cppRuntime.enemyIsRemovedAt(i)) {
                        bossAlive = true;
                        break;
                    }
                }
            }

            if (bossFound && !bossAlive) {
                state.goblinKingDefeated = true;
                setVictoryOverlayVisible(true);
            }
        }

        function renderFrame(now) {
            if (state.candleMechanic && state.candleMechanic.active) {
                let isBossAlive = false;
                const enemyCount = cppRuntime.enemyCount();
                for (let i = 0; i < enemyCount; i++) {
                    if (cppRuntime.enemyRoleKindAt && cppRuntime.enemyRoleKindAt(i) === 1 && !cppRuntime.enemyIsDeadAt(i) && !cppRuntime.enemyIsRemovedAt(i)) {
                        isBossAlive = true;
                        break;
                    }
                }

                if (!isBossAlive) {
                    state.candleMechanic.active = false;
                } else {
                    const currentTurn = cppRuntime.playerCurrentTurn();
                    if (currentTurn > state.candleMechanic.lastTurnProcessed) {
                        const turnsPassed = currentTurn - state.candleMechanic.lastTurnProcessed;
                        state.candleMechanic.lastTurnProcessed = currentTurn;

                        for (let i = 0; i < turnsPassed; i++) {
                            const activeCandle = CANDLE_POSITIONS[state.candleMechanic.currentIndex];
                            const healAmount = 25;

                            const px = cppRuntime.playerTileX();
                            const py = cppRuntime.playerTileY();
                            if (Math.abs(px - activeCandle.x) <= 1 && Math.abs(py - activeCandle.y) <= 1) {
                                if (!cppRuntime.playerIsDead() && cppRuntime.playerCurrentHp() > 0) {
                                    cppRuntime.setPlayerHp(Math.min(cppRuntime.playerMaxHp(), cppRuntime.playerCurrentHp() + healAmount));
                                }
                            }

                            /* for (let e = 0; e < enemyCount; e++) {
                                if (cppRuntime.enemyIsRemovedAt(e) || cppRuntime.enemyIsDeadAt(e)) continue;
                                const ex = cppRuntime.enemyTileXAt(e);
                                const ey = cppRuntime.enemyTileYAt(e);
                                if (Math.abs(ex - activeCandle.x) <= 1 && Math.abs(ey - activeCandle.y) <= 1) {
                                    const newHp = Math.min(cppRuntime.enemyMaxHpAt(e), cppRuntime.enemyCurrentHpAt(e) + healAmount);
                                    cppRuntime.enemySetHpAt(e, newHp);
                                }
                            } */

                            state.candleMechanic.turnsLeft--;
                            if (state.candleMechanic.turnsLeft <= 0) {
                                state.candleMechanic.currentIndex = (state.candleMechanic.currentIndex + 1) % CANDLE_POSITIONS.length;
                                state.candleMechanic.turnsLeft = 5;
                            }
                        }
                    }
                }
            }

            const enemyCount = cppRuntime.enemyCount();
            for (let i = 0; i < enemyCount; i++) {
                if (cppRuntime.enemyIsRemovedAt(i) || cppRuntime.enemyIsDeadAt(i)) continue;
                const castingId = cppRuntime.enemyCastingSkillIdAt(i);
                if (castingId > 0 && cppRuntime.enemyConsumeSkillImpactAt(i)) {
                    if (castingId === 1) { // 技能1：引燃
                        showPlayerBubble("【引燃】全场蜡烛区域沸腾！", 4000);
                        state.bossIgniteMechanic.active = true;
                        state.bossIgniteMechanic.turnsLeft = 5;
                        state.bossIgniteMechanic.lastTurnProcessed = cppRuntime.playerCurrentTurn();
                    } 
                    else if (castingId === 2) { // 技能2：兵来
                        showPlayerBubble("【兵来】哥布林大王召唤了手下！", 4000);
                        const spawnPos = [{ x: 14, y: 19 }, { x: 20, y: 19 }, { x: 17, y: 19 }];
                        for (const pos of spawnPos) {
                            const newIdx = cppRuntime.enemyCount();
                            if (typeof cppRuntime.enemySetRoleAt === 'function') {
                                cppRuntime.enemySetRoleAt(newIdx, 0);
                            }
                            cppRuntime.setEnemySpawnAt(newIdx, pos.x, pos.y);
                        }
                    } 
                    else if (castingId === 3) { // 技能3：化形
                        showPlayerBubble("【化形】大王偷学了你的绝招！", 4000);
                        const isArcher = cppRuntime.playerRoleName().includes("只射直线的传奇弓箭手");
                        const bossAtk = cppRuntime.enemyAttackPowerAt(i);
                        const bX = cppRuntime.enemyTileXAt(i);
                        const bY = cppRuntime.enemyTileYAt(i);
                        const pX = cppRuntime.playerTileX();
                        const pY = cppRuntime.playerTileY();

                        if (isArcher) {
                            bossShootEightWayArrows(bX, bY, Math.floor(bossAtk * 0.5));
                        } else {
                            bossShootBigWave(bX, bY, pX, pY, Math.floor(bossAtk - 10));
                        }
                    }
                }
            }

            if (state.bossIgniteMechanic && state.bossIgniteMechanic.active) {
                const currentTurn = cppRuntime.playerCurrentTurn();
                if (currentTurn > state.bossIgniteMechanic.lastTurnProcessed) {
                    const turnsPassed = currentTurn - state.bossIgniteMechanic.lastTurnProcessed;
                    state.bossIgniteMechanic.lastTurnProcessed = currentTurn;

                    for (let k = 0; k < turnsPassed; k++) {
                        const px = cppRuntime.playerTileX();
                        const py = cppRuntime.playerTileY();
                        let hitByIgnite = false;

                        for (const candle of CANDLE_POSITIONS) {
                            if (Math.abs(px - candle.x) <= 2 && Math.abs(py - candle.y) <= 2) {
                                hitByIgnite = true; break;
                            }
                        }

                        if (hitByIgnite && !cppRuntime.playerIsDead() && cppRuntime.playerCurrentHp() > 0) {
                            cppRuntime.setPlayerHp(Math.max(0, cppRuntime.playerCurrentHp() - 15));
                        }

                        state.bossIgniteMechanic.turnsLeft--;
                        if (state.bossIgniteMechanic.turnsLeft <= 0) {
                            state.bossIgniteMechanic.active = false;
                            break;
                        }
                    }
                }
            }

            const currentNow = now ?? performance.now();
            cppRuntime.update(currentNow);

            if (gameplayReady && currentNow < startupSafetyUntilMs) {
                if (cppRuntime.playerIsDead() || cppRuntime.playerCurrentHp() <= 0) {
                    cppRuntime.playerRevive(currentNow);
                }
            }

            if (gameplayReady && cppRuntime.playerCurrentHp() > 0 && !cppRuntime.playerIsDead()) {
                hasSeenPlayerAlive = true;
            }

            if (gameplayReady) {
                const hpNow = cppRuntime.playerCurrentHp();
                if (lastObservedHp !== hpNow && currentNow > 100) {
                    console.log(`[HP变化] 时间: ${currentNow.toFixed(0)}ms, 血量从 ${lastObservedHp} 变成了 ${hpNow}`);
                }

                if (
                    hasSeenPlayerAlive &&
                    currentNow >= startupSafetyUntilMs &&
                    lastObservedHp !== null &&
                    lastObservedHp > 0 &&
                    hpNow <= 0
                ) {
                    console.log('Player died! HP went from', lastObservedHp, 'to', hpNow);
                    deathByHpTransition = true;
                }

                if (hpNow > 0) {
                    deathByHpTransition = false;
                }

                lastObservedHp = hpNow;
            }

            drawMap();
            updateArrowProjectiles(currentNow);
            updateSoldierPosition();
            updateEnemyPositions();
            updateDarkness();
            updatePositionText();
            syncDeathOverlay();
            try {
                if (config.mapFileName === 'map03.html' && !state.goblinKingSpawned) {
                    const enemyCountNow = cppRuntime.enemyCount();
                    let aliveEnemies = 0;
                    for (let i = 0; i < enemyCountNow; i++) {
                        if (cppRuntime.enemyIsRemovedAt(i)) continue;
                        if (!cppRuntime.enemyIsDeadAt(i)) aliveEnemies++;
                    }
                    if (aliveEnemies === 0) {
                        const spawnIndex = cppRuntime.enemyCount();
                        if (typeof cppRuntime.enemySetRoleAt === 'function') {
                            cppRuntime.enemySetRoleAt(spawnIndex, 1);
                        }
                        cppRuntime.setEnemySpawnAt(spawnIndex, 17, 19);
                        state.goblinKingSpawned = true;
                        state.goblinKingDefeated = false;
                        state.portalClosed = true;
                        showPlayerBubble("好凶的哥布林！而且回去的路好像被堵上了……", 4200);
                    }
                    state.candleMechanic.active = true;
                state.candleMechanic.currentIndex = Math.floor(Math.random() * CANDLE_POSITIONS.length);
                state.candleMechanic.turnsLeft = 5;
                state.candleMechanic.lastTurnProcessed = cppRuntime.playerCurrentTurn();
                }
            } catch (err) {
                console.warn('boss spawn check failed:', err);
            }

            checkSpecialEvent();
            syncVictoryOverlay();
        }

        function bossShootEightWayArrows(startX, startY, damage) {
            const pX = cppRuntime.playerTileX();
            const pY = cppRuntime.playerTileY();
            const dirs = [
                {x: -1, y: 0}, {x: 1, y: 0}, {x: 0, y: -1}, {x: 0, y: 1},
                {x: -1, y: -1}, {x: 1, y: -1}, {x: -1, y: 1}, {x: 1, y: 1}
            ];
            const maxRange = 10;
            let hitPlayer = false;
            const gridOffset = 1.6 * config.worldScale * state.tileHeight;

            dirs.forEach(initialDir => {
                let current = { x: startX, y: startY };
                let dir = { x: initialDir.x, y: initialDir.y };
                let turned = false;
                const tileSegments = [current];

                for (let travelled = 0; travelled < maxRange; travelled++) {
                    let next = { x: current.x + dir.x, y: current.y + dir.y };
                    if (isSolidTileAt(next.x, next.y + config.collisionTileOffsetY)) {
                        if (turned) break;
                        dir.x = -dir.x; dir.y = -dir.y;
                        turned = true;
                        next = { x: current.x + dir.x, y: current.y + dir.y };
                        if (isSolidTileAt(next.x, next.y + config.collisionTileOffsetY)) break;
                    }
                    current = next;
                    tileSegments.push(current);
                    if (current.x === pX && current.y === pY) hitPlayer = true;
                }

                if (tileSegments.length > 1) {
                    const worldSegments = tileSegments.map(t => {
                        const tw = tileToWorldPoint(t.x, t.y);
                        return { x: tw.x, y: tw.y - config.soldierFrame * 0.44 - gridOffset };
                    });
                    state.arrowShots.list.push({
                        startMs: performance.now(), durationMs: 300,
                        startX: worldSegments[0].x, startY: worldSegments[0].y,
                        targetX: worldSegments[worldSegments.length - 1].x,
                        targetY: worldSegments[worldSegments.length - 1].y,
                        segments: worldSegments, isBossSkill: true
                    });
                }
            });

            if (hitPlayer && !cppRuntime.playerIsDead() && cppRuntime.playerCurrentHp() > 0) {
                cppRuntime.setPlayerHp(Math.max(0, cppRuntime.playerCurrentHp() - damage));
            }
        }

        function bossShootBigWave(startX, startY, pX, pY, damage) {
            let dx = pX - startX, dy = pY - startY;
            let facingX = 0, facingY = 0;
            if (Math.abs(dx) >= Math.abs(dy)) facingX = dx > 0 ? 1 : -1;
            else facingY = dy > 0 ? 1 : -1;

            let hit = false;
            if (facingX !== 0 && (pX - startX) * facingX > 0 && Math.abs(pY - startY) <= 1) hit = true;
            if (facingY !== 0 && (pY - startY) * facingY > 0 && Math.abs(pX - startX) <= 1) hit = true;

            if (hit && !cppRuntime.playerIsDead() && cppRuntime.playerCurrentHp() > 0) {
                cppRuntime.setPlayerHp(Math.max(0, cppRuntime.playerCurrentHp() - damage)); 
            }

            state.bossWaveFx.active = true;
            state.bossWaveFx.alpha = 1.0;
            const tw = tileToWorldPoint(startX, startY);
            state.bossWaveFx.x = tw.x; 
            state.bossWaveFx.y = tw.y;
            state.bossWaveFx.targetX = tw.x + facingX * 250;
            state.bossWaveFx.targetY = tw.y + facingY * 250;
            state.bossWaveFx.facingX = facingX; 
            state.bossWaveFx.facingY = facingY;
        }

        function animate(now) {
            renderFrame(now);
            requestAnimationFrame(animate);
        }

        async function init() {
            try {
                cppRuntime = await createCppRuntime();
                cppRuntime.init({
                    tileWidth: config.tileSize,
                    tileHeight: config.tileSize,
                    worldScale: config.worldScale,
                    feetOffsetY: config.soldierFeetOffsetY,
                    moveDurationMs: config.moveDurationMs,
                    attackDurationMs: config.attackDurationMs,
                    deadZoneRatioX: config.cameraDeadzoneRatioX,
                    topDeadZoneRatioY: config.cameraTopDeadzoneRatioY,
                    bottomDeadZoneRatioY: config.cameraBottomDeadzoneRatioY
                });

                const roleParams = new URLSearchParams(window.location.search);
                const roleValue = roleParams.get('role');
                if (roleValue === 'plainPhysicalMage') {
                    cppRuntime.setPlayerRole(0);
                } else if (roleValue === 'legendaryLineArcher') {
                    cppRuntime.setPlayerRole(1);
                }

                const tmxText = await fetch(config.tmxPath).then((r) => r.text());
                const mapDoc = new DOMParser().parseFromString(tmxText, 'text/xml');
                const mapNode = mapDoc.querySelector('map');

                if (!mapNode) throw new Error('TMX 缺少 <map> 节点');

                state.width = Number(mapNode.getAttribute('width'));
                state.height = Number(mapNode.getAttribute('height'));
                state.tileWidth = Number(mapNode.getAttribute('tilewidth')) || config.tileSize;
                state.tileHeight = Number(mapNode.getAttribute('tileheight')) || config.tileSize;

                const layer = mapDoc.querySelector('layer data');
                if (!layer) throw new Error('TMX 缺少图层数据');

                state.gids = parseCsvData(layer.textContent || '');

                const tilesetNode = mapDoc.querySelector('tileset');
                if (tilesetNode) {
                    const firstGid = Number(tilesetNode.getAttribute('firstgid')) || 1;
                    const source = tilesetNode.getAttribute('source');

                    if (source) {
                        const tsxUrl = new URL(source, new URL(config.tmxPath, window.location.href)).href;
                        state.solidGids = await loadTilesetData(tsxUrl, firstGid);
                    }
                }

                resizeViewport();

                const solidGrid = new Uint8Array(state.width * state.height);
                for (let y = 0; y < state.height; y++) {
                    for (let x = 0; x < state.width; x++) {
                        solidGrid[y * state.width + x] = isSolidTileAt(x, y) ? 1 : 0;
                    }
                }

                cppRuntime.setWorld(getWorldWidth(), getWorldHeight());
                cppRuntime.setViewport(state.viewportWidth, state.viewportHeight);
                cppRuntime.setCollisionGrid(state.width, state.height, config.collisionTileOffsetY, solidGrid);

                const entryParams = new URLSearchParams(window.location.search);
                const entry = entryParams.get('entry');
                let spawnTileX = config.spawnTile.x;
                let spawnTileY = config.spawnTile.y;
                if (
                    config.returnEntryFrom &&
                    config.returnSpawnTile &&
                    entry === config.returnEntryFrom
                ) {
                    spawnTileX = config.returnSpawnTile.x;
                    spawnTileY = config.returnSpawnTile.y;
                    specialEventCooldownUntilMs = performance.now();
                }

                cppRuntime.setSpawn(spawnTileX, spawnTileY);
                for (let i = 0; i < ENEMY_SPAWNS.length; i++) {
                    cppRuntime.setEnemySpawnAt(i, ENEMY_SPAWNS[i].x, ENEMY_SPAWNS[i].y);
                }

                cppRuntime.playerRevive(performance.now());

                const savedHp = sessionStorage.getItem('yz_global_hp');
                if (savedHp !== null) {
                    const hpValue = parseInt(savedHp);
                    if (hpValue > 0) {
                        cppRuntime.setPlayerHp(hpValue);
                    }
                }

                cppRuntime.centerCamera();
                gameplayReady = true;
                startupSafetyUntilMs = performance.now() + config.startupSafetyDurationMs;
                hasSeenPlayerAlive = false;
                lastObservedHp = cppRuntime.playerCurrentHp();
                deathByHpTransition = false;

                state.lastTileX = cppRuntime.playerTileX();
                state.lastTileY = cppRuntime.playerTileY();
                setDeathOverlayVisible(false);
                setVictoryOverlayVisible(false);
                state.playerDeathShown = false;
                statusEl.textContent = `${cppRuntime.playerRoleName()} | HP ${cppRuntime.playerCurrentHp()}/${cppRuntime.playerMaxHp()} | ATK ${cppRuntime.playerAttackPower()} | 当前位置: (${state.lastTileX}, ${state.lastTileY})`;
                renderFrame(performance.now());
                checkSpecialEvent();
                void startMapBgm();

                if (config.mapFileName === 'map02.html') {
                    setTimeout(() => showPlayerBubble("好黑啊……", 3800), 500);
                }

                if (config.mapFileName === 'map01.html') {
                    const visitedMap01 = sessionStorage.getItem('yz_visited_map01') === 'true';
                    if (!visitedMap01) {

                        sessionStorage.setItem('yz_visited_map01', 'true');

                        setTimeout(() => {
                            showPlayerBubble("糟了……这座地牢貌似充满亡灵气息，一旦离开这层，怪物都会恢复原状", 5000);
                        }, 800);
                    }
                }

                reviveButtonEl.addEventListener('click', () => {
                    if (!cppRuntime) return;
                    cppRuntime.playerRevive(performance.now());

                    const fullHp = cppRuntime.playerMaxHp();
                    sessionStorage.setItem('yz_global_hp', fullHp);
                    setDeathOverlayVisible(false);
                    setVictoryOverlayVisible(false);
                    state.playerDeathShown = false;
                    lastObservedHp = cppRuntime.playerCurrentHp();
                    deathByHpTransition = false;
                    renderFrame(performance.now());
                });

                exitButtonEl.addEventListener('click', () => {
                    setDeathOverlayVisible(false);
                    const runToken = new URLSearchParams(window.location.search).get('run');
                    const target = buildExitTarget(runToken);
                    fadeOutMapBgmAndLeave(target);
                });

                if (victoryExitButtonEl) {
                    victoryExitButtonEl.addEventListener('click', () => {
                        setVictoryOverlayVisible(false);
                        const runToken = new URLSearchParams(window.location.search).get('run');
                        const target = buildExitTarget(runToken);
                        fadeOutMapBgmAndLeave(target);
                    });
                }

                setDeathOverlayVisible(false);
                setVictoryOverlayVisible(false);

                window.addEventListener('resize', () => {
                    resizeViewport();
                    cppRuntime.centerCamera();
                    renderFrame(performance.now());
                });

                requestAnimationFrame(animate);
            } catch (error) {
                console.error(error);
                gameplayReady = false;
                statusEl.textContent = `地图加载失败：${error?.message || 'C++ 模块加载失败'}。请确认已构建 cpp/web/game_core.js 与 game_core.wasm，并通过本地服务器访问。`;
            }
        }

        document.addEventListener('keydown', (event) => {
            if (event.key.startsWith('Arrow')) event.preventDefault();
            const key = event.key.toLowerCase();
            if (key === 'arrowup' || key === 'w') movePlayer(0, -1);
            if (key === 'arrowdown' || key === 's') movePlayer(0, 1);
            if (key === 'arrowleft' || key === 'a') movePlayer(-1, 0);
            if (key === 'arrowright' || key === 'd') movePlayer(1, 0);
            if (key === 'j' && !event.repeat) {
                event.preventDefault();
                requestAttack();
            }
            if (key === 'e' && !event.repeat) {
                event.preventDefault();
                requestSmallSkill();
            }
            if (key === 'q' && !event.repeat) {
                event.preventDefault();
                requestBigSkill();
            }
        });

        document.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            requestAttack();
        });

        window.addEventListener('pagehide', stopMapBgmImmediate);

        init();
    }

    window.startMapGame = startMapGame;
})();
