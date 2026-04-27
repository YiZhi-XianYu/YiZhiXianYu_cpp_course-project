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
        specialEventMode: 'cooldown'
    };

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

        const mapBgmAudio = new Audio(config.mapBgmSrc);
        mapBgmAudio.loop = true;
        mapBgmAudio.preload = 'auto';
        mapBgmAudio.volume = 0;

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
        let gameplayReady = false;
        let startupSafetyUntilMs = 0;
        let hasSeenPlayerAlive = false;
        let lastObservedHp = null;
        let deathByHpTransition = false;

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
            }
        };

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

            // 保持你精心微调过的 1.6 倍高度偏移
            const gridOffset = 1.6 * config.worldScale * state.tileHeight;
            const startX = cppRuntime.playerWorldX();
            const startY = cppRuntime.playerWorldY() - config.soldierFrame * 0.44 - gridOffset;
            const facingX = cppRuntime.playerFacingX() < 0 ? -1 : 1;

            // ==== 小技能：反弹与散弹逻辑 ====
            if (isSmallSkill) {
                let pathTiles = [];
                let current = { x: cppRuntime.playerTileX(), y: cppRuntime.playerTileY() };
                
                let fx = Math.sign(attackTiles[0].x - current.x);
                let fy = Math.sign(attackTiles[0].y - current.y);
                if (fx === 0 && fy === 0) fx = facingX;

                let bounces = 0;
                let hitEnemyPos = null;

                for (let step = 1; step <= 15; ++step) {
                    let next = { x: current.x + fx, y: current.y + fy };

                    if (isSolidTileAt(next.x, next.y + config.collisionTileOffsetY)) {
                        if (bounces >= 2) break;
                        bounces++;

                        let lx = fy, ly = -fx, rx = -fy, ry = fx; 
                        let leftBlocked = isSolidTileAt(current.x + lx, current.y + ly + config.collisionTileOffsetY);
                        let rightBlocked = isSolidTileAt(current.x + rx, current.y + ry + config.collisionTileOffsetY);

                        if (leftBlocked && !rightBlocked) { fx = rx; fy = ry; } 
                        else if (rightBlocked && !leftBlocked) { fx = lx; fy = ly; } 
                        else { fx = -fx; fy = -fy; }
                        
                        next = { x: current.x + fx, y: current.y + fy };
                        if (isSolidTileAt(next.x, next.y + config.collisionTileOffsetY)) break;
                    }

                    current = next;
                    pathTiles.push(current);

                    let hit = false;
                    for (let i = 0; i < cppRuntime.enemyCount(); i++) {
                        if (!cppRuntime.enemyIsRemovedAt(i) && !cppRuntime.enemyIsDeadAt(i)) {
                            if (cppRuntime.enemyTileXAt(i) === current.x && cppRuntime.enemyTileYAt(i) === current.y) {
                                hit = true; break;
                            }
                        }
                    }
                    if (hit) { hitEnemyPos = current; break; }
                }

                let segments = [{x: startX, y: startY}];
                for(const t of pathTiles) {
                    const tw = tileToWorldPoint(t.x, t.y);
                    segments.push({x: tw.x, y: tw.y - config.soldierFrame * 0.44 - gridOffset});
                }

                setTimeout(() => {
                    state.arrowShots.list.push({
                        startMs: performance.now(),
                        durationMs: Math.max(80, config.attackDurationMs * 0.5),
                        segments: segments,
                        isSmallSkill: true
                    });
                }, config.attackDurationMs * 0.8);

                if (hitEnemyPos) {
                    setTimeout(() => {
                        const dx = [-1, 1, 0, 0, -1, 1, -1, 1];
                        const dy = [0, 0, -1, 1, -1, -1, 1, 1];
                        const spreadRange = 10;
                        for(let d=0; d<8; d++) {
                            const twStart = tileToWorldPoint(hitEnemyPos.x, hitEnemyPos.y);

                            let endTile = null;
                            for (let dist = 1; dist <= spreadRange; dist++) {
                                const tx = hitEnemyPos.x + dx[d] * dist;
                                const ty = hitEnemyPos.y + dy[d] * dist;

                                if (isSolidTileAt(tx, ty + config.collisionTileOffsetY)) {
                                    break;
                                }

                                endTile = { x: tx, y: ty };

                                let hit = false;
                                for (let i = 0; i < cppRuntime.enemyCount(); i++) {
                                    if (!cppRuntime.enemyIsRemovedAt(i) && !cppRuntime.enemyIsDeadAt(i)) {
                                        if (cppRuntime.enemyTileXAt(i) === tx && cppRuntime.enemyTileYAt(i) === ty) {
                                            hit = true;
                                            break;
                                        }
                                    }
                                }
                                if (hit) {
                                    break;
                                }
                            }

                            if (!endTile) {
                                continue;
                            }

                            const twEnd = tileToWorldPoint(endTile.x, endTile.y);
                            state.arrowShots.list.push({
                                startMs: performance.now(),
                                durationMs: 150, 
                                startX: twStart.x,
                                startY: twStart.y - config.soldierFrame * 0.44 - gridOffset,
                                targetX: twEnd.x,
                                targetY: twEnd.y - config.soldierFrame * 0.44 - gridOffset,
                                isSmallSkill: false 
                            });
                        }
                    }, config.attackDurationMs * 1.3);
                }
                return;
            }

            // ==== 原版普通攻击逻辑 ====
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
                
                if (shot.isSmallSkill) {
                    el.style.filter = 'drop-shadow(0 0 8px white) drop-shadow(0 0 16px white) brightness(2)';
                } else {
                    el.style.filter = 'none';
                }
            }
        }

        function requestAttack() {
            if (!cppRuntime || !gameplayReady || deathOverlayVisible || isPlayerDeadState()) return;
            cppRuntime.requestAttack(performance.now());
        }

        function requestSmallSkill() {
            if (!cppRuntime || !gameplayReady || deathOverlayVisible || isPlayerDeadState()) return;
            cppRuntime.requestSmallSkill(performance.now());
        }

        function requestBigSkill() {
            if (!cppRuntime || !gameplayReady || deathOverlayVisible || isPlayerDeadState()) return;
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
            const smallSkillActive = cppRuntime.playerSmallSkillActive();
            const archerBlessingActive = cppRuntime.playerArcherBlessingActive();

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
            soldierEl.classList.toggle('is-archer-blessing-active', archerBlessingActive);
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

        function triggerSpecialEvent() {
            const query = new URLSearchParams(window.location.search);
            const runToken = query.get('run');
            const sessionToken = query.get('session');
            const role = query.get('role');
            const params = [];

            if (runToken) params.push(`run=${encodeURIComponent(runToken)}`);
            if (sessionToken) params.push(`session=${encodeURIComponent(sessionToken)}`);
            if (role) params.push(`role=${encodeURIComponent(role)}`);
            if (config.specialEventEntryTag) {
                params.push(`entry=${encodeURIComponent(config.specialEventEntryTag)}`);
            }

            let target = config.specialEventTarget;
            if (params.length > 0) {
                target += `?${params.join('&')}`;
            }

            fadeOutMapBgmAndLeave(target);
        }

        function checkSpecialEvent() {
            if (state.specialEventTriggered) return;

            const playerTileX = cppRuntime.playerTileX();
            const playerTileY = cppRuntime.playerTileY();
            const reachedEvent = playerTileX === config.eventTile.x && playerTileY === config.eventTile.y;

            if (config.specialEventMode === 'armed') {
                if (reachedEvent) {
                    if (specialEventArmed) {
                        state.specialEventTriggered = true;
                        triggerSpecialEvent();
                    }
                } else {
                    specialEventArmed = true;
                }
                return;
            }

            if (config.specialEventMode === 'cooldown' && performance.now() < specialEventCooldownUntilMs) {
                return;
            }

            if (reachedEvent) {
                state.specialEventTriggered = true;
                triggerSpecialEvent();
            }
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
                    // 小技能扩散箭不绘制地块高亮，避免误导范围显示。
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
                updateEnemyAnimationAt(enemyEl, i, px, py, now);
            }
        }

        function movePlayer(dx, dy) {
            if (!cppRuntime || !gameplayReady || deathOverlayVisible || isPlayerDeadState()) return;
            cppRuntime.requestMove(dx, dy, performance.now());
        }

        function updatePositionText() {
            const currentX = cppRuntime.playerTileX();
            const currentY = cppRuntime.playerTileY();

            const playerHp = cppRuntime.playerCurrentHp();
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
                if (deathOverlayVisible) {
                    deathOverlayEl.hidden = true;
                    deathOverlayVisible = false;
                }
                state.playerDeathShown = false;
                return;
            }

            const playerDead = isPlayerDeadState();
            const deathFinished = cppRuntime.playerDeathFinished();

            if (!playerDead) {
                if (deathOverlayVisible) {
                    deathOverlayEl.hidden = true;
                    deathOverlayVisible = false;
                }
                state.playerDeathShown = false;
                return;
            }

            if (!deathByHpTransition) {
                return;
            }

            if (playerDead && deathFinished) {
                if (!deathOverlayVisible) {
                    deathOverlayEl.hidden = false;
                    deathOverlayVisible = true;
                }
                state.playerDeathShown = true;
            }
        }

        function renderFrame(now) {
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
            updatePositionText();
            syncDeathOverlay();
            checkSpecialEvent();
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
                cppRuntime.centerCamera();
                gameplayReady = true;
                startupSafetyUntilMs = performance.now() + config.startupSafetyDurationMs;
                hasSeenPlayerAlive = false;
                lastObservedHp = cppRuntime.playerCurrentHp();
                deathByHpTransition = false;

                state.lastTileX = cppRuntime.playerTileX();
                state.lastTileY = cppRuntime.playerTileY();
                deathOverlayEl.hidden = true;
                deathOverlayVisible = false;
                state.playerDeathShown = false;
                statusEl.textContent = `${cppRuntime.playerRoleName()} | HP ${cppRuntime.playerCurrentHp()}/${cppRuntime.playerMaxHp()} | ATK ${cppRuntime.playerAttackPower()} | 当前位置: (${state.lastTileX}, ${state.lastTileY})`;
                renderFrame(performance.now());
                checkSpecialEvent();
                void startMapBgm();

                reviveButtonEl.addEventListener('click', () => {
                    if (!cppRuntime) return;
                    cppRuntime.playerRevive(performance.now());
                    deathOverlayEl.hidden = true;
                    deathOverlayVisible = false;
                    state.playerDeathShown = false;
                    lastObservedHp = cppRuntime.playerCurrentHp();
                    deathByHpTransition = false;
                    renderFrame(performance.now());
                });

                exitButtonEl.addEventListener('click', () => {
                    deathOverlayEl.hidden = true;
                    deathOverlayVisible = false;
                    const runToken = new URLSearchParams(window.location.search).get('run');
                    const target = buildExitTarget(runToken);
                    fadeOutMapBgmAndLeave(target);
                });

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
