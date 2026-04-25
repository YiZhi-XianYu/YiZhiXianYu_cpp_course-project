@echo off
setlocal EnableExtensions

if "%~1"=="" (
    echo 未提供仓库根目录。
    exit /b 1
)

set "REPO_ROOT=%~1"
if not exist "%REPO_ROOT%" (
    echo 仓库根目录不存在: %REPO_ROOT%
    exit /b 1
)

set "EMCC_CMD="
if exist "%REPO_ROOT%\tools\emsdk\upstream\emscripten\emcc.bat" (
    set "EMCC_CMD=%REPO_ROOT%\tools\emsdk\upstream\emscripten\emcc.bat"
)

if not defined EMCC_CMD (
    for /f "delims=" %%I in ('where emcc.bat 2^>nul') do set "EMCC_CMD=%%I"
)

if not defined EMCC_CMD (
    echo 未找到 emcc，请先安装或激活 Emscripten SDK。
    exit /b 1
)

pushd "%REPO_ROOT%"
call "%EMCC_CMD%" cpp/src/web/GameCoreBridge.cpp cpp/src/core/CharacterRole.cpp cpp/src/core/MonsterRole.cpp cpp/src/core/PlayerController.cpp cpp/src/core/MonsterController.cpp cpp/src/core/CameraController.cpp ^
    -Icpp/src ^
    -O2 ^
    -sEXPORTED_FUNCTIONS=["_malloc","_free","_gc_init","_gc_set_world","_gc_set_viewport","_gc_set_collision_grid","_gc_set_spawn","_gc_enemy_set_spawn","_gc_enemy_set_spawn_at","_gc_enemy_count","_gc_center_camera","_gc_request_move","_gc_request_attack","_gc_request_small_skill","_gc_request_big_skill","_gc_player_revive","_gc_update","_gc_player_tile_x","_gc_player_tile_y","_gc_player_world_x","_gc_player_world_y","_gc_player_facing_x","_gc_player_facing_y","_gc_player_is_walking","_gc_player_is_moving","_gc_player_is_attacking","_gc_player_is_hurt","_gc_player_is_dead","_gc_player_death_finished","_gc_player_current_hp","_gc_player_attack_variant","_gc_player_role_name","_gc_player_max_hp","_gc_player_attack_power","_gc_player_attack_power_percent","_gc_player_auto_lock_enabled","_gc_player_small_skill_active","_gc_player_small_skill_turns_left","_gc_player_small_skill_cooldown_left","_gc_player_big_skill_cooldown_left","_gc_player_big_wave_active","_gc_player_attack_area_count","_gc_player_attack_area_x","_gc_player_attack_area_y","_gc_player_big_wave_area_count","_gc_player_big_wave_area_x","_gc_player_big_wave_area_y","_gc_enemy_tile_x","_gc_enemy_tile_y","_gc_enemy_world_x","_gc_enemy_world_y","_gc_enemy_facing_x","_gc_enemy_facing_y","_gc_enemy_is_walking","_gc_enemy_is_attacking","_gc_enemy_is_hurt","_gc_enemy_is_dead","_gc_enemy_is_removed","_gc_enemy_attack_variant","_gc_enemy_is_discovered","_gc_enemy_role_name","_gc_enemy_max_hp","_gc_enemy_current_hp","_gc_enemy_attack_power","_gc_enemy_attack_area_count","_gc_enemy_attack_area_x","_gc_enemy_attack_area_y","_gc_enemy_tile_x_at","_gc_enemy_tile_y_at","_gc_enemy_world_x_at","_gc_enemy_world_y_at","_gc_enemy_facing_x_at","_gc_enemy_facing_y_at","_gc_enemy_is_walking_at","_gc_enemy_is_attacking_at","_gc_enemy_is_hurt_at","_gc_enemy_is_dead_at","_gc_enemy_is_removed_at","_gc_enemy_attack_variant_at","_gc_enemy_is_discovered_at","_gc_enemy_current_hp_at","_gc_enemy_attack_area_count_at","_gc_enemy_attack_area_x_at","_gc_enemy_attack_area_y_at","_gc_camera_x","_gc_camera_y"] ^
    -sEXPORTED_RUNTIME_METHODS=["cwrap"] ^
    -sMODULARIZE=1 ^
    -sEXPORT_NAME=createGameCoreModule ^
    -o cpp/web/game_core.js
set "BUILD_CODE=%errorlevel%"
popd

if not "%BUILD_CODE%"=="0" (
    exit /b %BUILD_CODE%
)

echo WASM 自动构建完成。
exit /b 0
