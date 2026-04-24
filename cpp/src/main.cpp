#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

#include <thread>
#include <chrono>

#ifdef _WIN32
#include <windows.h>
#endif

namespace {

std::filesystem::path findIndexHtml() {
    auto current = std::filesystem::current_path();

    for (int depth = 0; depth < 8; ++depth) {
        const auto candidate = current / "index.html";
        if (std::filesystem::exists(candidate)) {
            return std::filesystem::absolute(candidate);
        }

        if (!current.has_parent_path()) break;
        current = current.parent_path();
    }

    return {};
}

bool openInBrowser(const std::wstring& target) {
#ifdef _WIN32
    const auto result = reinterpret_cast<std::uintptr_t>(
        ShellExecuteW(nullptr, L"open", target.c_str(), nullptr, nullptr, SW_SHOWNORMAL)
    );
    return result > 32;
#else
    (void)target;
    return false;
#endif
}

bool launchDetachedCommand(const std::wstring& commandLine) {
#ifdef _WIN32
    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    PROCESS_INFORMATION processInfo{};

    std::wstring mutableCommand = commandLine;
    const BOOL created = CreateProcessW(
        nullptr,
        mutableCommand.data(),
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW | DETACHED_PROCESS,
        nullptr,
        nullptr,
        &startupInfo,
        &processInfo
    );

    if (!created) return false;

    // If the process exits almost immediately, treat it as a failed launch
    // (common when python/py is missing or port is already occupied).
    const DWORD waitResult = WaitForSingleObject(processInfo.hProcess, 800);
    if (waitResult == WAIT_OBJECT_0) {
        CloseHandle(processInfo.hThread);
        CloseHandle(processInfo.hProcess);
        return false;
    }

    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);
    return true;
#else
    (void)commandLine;
    return false;
#endif
}

bool launchCommandAndWait(
    const std::wstring& commandLine,
    const std::wstring* workingDirectory = nullptr,
    DWORD* exitCode = nullptr
) {
#ifdef _WIN32
    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    PROCESS_INFORMATION processInfo{};

    std::wstring mutableCommand = commandLine;
    const BOOL created = CreateProcessW(
        nullptr,
        mutableCommand.data(),
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW,
        nullptr,
        workingDirectory ? workingDirectory->c_str() : nullptr,
        &startupInfo,
        &processInfo
    );

    if (!created) return false;

    WaitForSingleObject(processInfo.hProcess, INFINITE);

    DWORD code = 1;
    if (!GetExitCodeProcess(processInfo.hProcess, &code)) {
        code = 1;
    }

    if (exitCode) {
        *exitCode = code;
    }

    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);
    return true;
#else
    (void)commandLine;
    (void)exitCode;
    return false;
#endif
}

std::filesystem::path buildScriptPath(const std::filesystem::path& rootDir) {
    return rootDir / "cpp" / "build_game_wasm.ps1";
}

std::filesystem::path emccPath(const std::filesystem::path& rootDir) {
#ifdef _WIN32
    const auto localEmcc = rootDir / "tools" / "emsdk" / "upstream" / "emscripten" / "emcc.bat";
    if (std::filesystem::exists(localEmcc)) {
        return std::filesystem::absolute(localEmcc);
    }
#endif
    return {};
}

std::filesystem::path wasmJsPath(const std::filesystem::path& rootDir) {
    return rootDir / "cpp" / "web" / "game_core.js";
}

std::filesystem::path wasmBinaryPath(const std::filesystem::path& rootDir) {
    return rootDir / "cpp" / "web" / "game_core.wasm";
}

std::filesystem::path buildStampPath(const std::filesystem::path& rootDir) {
    return rootDir / "cpp" / "web" / "game_core.build.stamp";
}

std::filesystem::file_time_type latestSourceTime(const std::filesystem::path& rootDir) {
    const std::filesystem::path files[] = {
        rootDir / "cpp" / "src" / "web" / "GameCoreBridge.cpp",
        rootDir / "cpp" / "src" / "core" / "CharacterRole.cpp",
        rootDir / "cpp" / "src" / "core" / "CharacterRole.hpp",
        rootDir / "cpp" / "src" / "core" / "MonsterRole.cpp",
        rootDir / "cpp" / "src" / "core" / "MonsterRole.hpp",
        rootDir / "cpp" / "src" / "core" / "PlayerController.cpp",
        rootDir / "cpp" / "src" / "core" / "PlayerController.hpp",
        rootDir / "cpp" / "src" / "core" / "MonsterController.cpp",
        rootDir / "cpp" / "src" / "core" / "MonsterController.hpp",
        rootDir / "cpp" / "src" / "core" / "CameraController.cpp",
        rootDir / "cpp" / "src" / "core" / "CameraController.hpp",
        rootDir / "cpp" / "src" / "core" / "Types.hpp"
    };

    auto latest = std::filesystem::file_time_type::min();
    for (const auto& file : files) {
        if (!std::filesystem::exists(file)) continue;
        const auto modified = std::filesystem::last_write_time(file);
        if (modified > latest) {
            latest = modified;
        }
    }

    return latest;
}

bool wasmNeedsRebuild(const std::filesystem::path& rootDir) {
    const auto jsPath = wasmJsPath(rootDir);
    const auto wasmPath = wasmBinaryPath(rootDir);
    if (!std::filesystem::exists(jsPath) || !std::filesystem::exists(wasmPath)) {
        return true;
    }

    const auto sourceTime = latestSourceTime(rootDir);
    const auto outputTime = std::min(
        std::filesystem::last_write_time(jsPath),
        std::filesystem::last_write_time(wasmPath)
    );

    return outputTime < sourceTime;
}

bool buildWasmModule(const std::filesystem::path& rootDir) {
#ifdef _WIN32
    if (!wasmNeedsRebuild(rootDir)) {
        return true;
    }

    const auto emcc = emccPath(rootDir);
    if (emcc.empty()) {
        std::cerr << "未找到 emcc.bat，请先安装或激活 Emscripten SDK。\n";
        return false;
    }

    const std::wstring commandLine =
        L"cmd.exe /C \"\"" + emcc.wstring() +
        L"\" cpp/src/web/GameCoreBridge.cpp cpp/src/core/CharacterRole.cpp cpp/src/core/MonsterRole.cpp cpp/src/core/PlayerController.cpp cpp/src/core/MonsterController.cpp cpp/src/core/CameraController.cpp "
        L"-Icpp/src -O2 "
        L"-sEXPORTED_FUNCTIONS=[\"_malloc\",\"_free\",\"_gc_init\",\"_gc_set_world\",\"_gc_set_viewport\",\"_gc_set_collision_grid\",\"_gc_set_spawn\",\"_gc_enemy_set_spawn\",\"_gc_center_camera\",\"_gc_request_move\",\"_gc_request_attack\",\"_gc_request_small_skill\",\"_gc_request_big_skill\",\"_gc_player_revive\",\"_gc_update\",\"_gc_player_tile_x\",\"_gc_player_tile_y\",\"_gc_player_world_x\",\"_gc_player_world_y\",\"_gc_player_facing_x\",\"_gc_player_facing_y\",\"_gc_player_is_walking\",\"_gc_player_is_moving\",\"_gc_player_is_attacking\",\"_gc_player_is_hurt\",\"_gc_player_is_dead\",\"_gc_player_death_finished\",\"_gc_player_current_hp\",\"_gc_player_attack_variant\",\"_gc_player_role_name\",\"_gc_player_max_hp\",\"_gc_player_attack_power\",\"_gc_player_attack_power_percent\",\"_gc_player_auto_lock_enabled\",\"_gc_player_small_skill_active\",\"_gc_player_small_skill_turns_left\",\"_gc_player_small_skill_cooldown_left\",\"_gc_player_big_skill_cooldown_left\",\"_gc_player_big_wave_active\",\"_gc_player_attack_area_count\",\"_gc_player_attack_area_x\",\"_gc_player_attack_area_y\",\"_gc_player_big_wave_area_count\",\"_gc_player_big_wave_area_x\",\"_gc_player_big_wave_area_y\",\"_gc_enemy_tile_x\",\"_gc_enemy_tile_y\",\"_gc_enemy_world_x\",\"_gc_enemy_world_y\",\"_gc_enemy_facing_x\",\"_gc_enemy_facing_y\",\"_gc_enemy_is_walking\",\"_gc_enemy_is_attacking\",\"_gc_enemy_is_hurt\",\"_gc_enemy_is_dead\",\"_gc_enemy_is_removed\",\"_gc_enemy_attack_variant\",\"_gc_enemy_is_discovered\",\"_gc_enemy_role_name\",\"_gc_enemy_max_hp\",\"_gc_enemy_current_hp\",\"_gc_enemy_attack_power\",\"_gc_enemy_attack_area_count\",\"_gc_enemy_attack_area_x\",\"_gc_enemy_attack_area_y\",\"_gc_camera_x\",\"_gc_camera_y\"] "
        L"-sEXPORTED_RUNTIME_METHODS=[\"cwrap\"] -sMODULARIZE=1 -sEXPORT_NAME=createGameCoreModule -o cpp/web/game_core.js\"";

    DWORD exitCode = 1;
    const std::wstring buildCwd = rootDir.wstring();
    if (!launchCommandAndWait(commandLine, &buildCwd, &exitCode)) {
        std::cerr << "无法启动 wasm 构建进程。\n";
        return false;
    }

    if (exitCode != 0) {
        std::cerr << "WASM 自动构建失败，退出码: " << exitCode << "\n";
        return false;
    }

    try {
        std::ofstream(buildStampPath(rootDir)) << "ok\n";
    } catch (...) {
        // stamp failure should not block launch
    }

    return true;
#else
    (void)rootDir;
    return false;
#endif
}

bool startLocalServer(const std::filesystem::path& rootDir) {
#ifdef _WIN32
    const std::wstring root = rootDir.wstring();

    const std::wstring pyCommand =
        L"py -3 -m http.server 8000 --bind 127.0.0.1 --directory \"" + root + L"\"";
    if (launchDetachedCommand(pyCommand)) return true;

    const std::wstring pythonCommand =
        L"python -m http.server 8000 --bind 127.0.0.1 --directory \"" + root + L"\"";
    return launchDetachedCommand(pythonCommand);
#else
    (void)rootDir;
    return false;
#endif
}

} // namespace

int main() {
    const auto indexPath = findIndexHtml();
    if (indexPath.empty()) {
        std::cerr << "未找到 index.html\n";
        return 1;
    }

    const auto rootDir = indexPath.parent_path();
    if (!buildWasmModule(rootDir)) {
        std::cerr << "启动前自动构建 wasm 失败，游戏未启动。\n";
        return 4;
    }

    if (!startLocalServer(rootDir)) {
        std::cerr << "无法启动本地 HTTP 服务，回退到直接打开文件。\n";
        if (!openInBrowser(indexPath.wstring())) {
            std::cerr << "无法打开: " << indexPath.string() << "\n";
            return 2;
        }
        return 0;
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(1200));
    if (!openInBrowser(L"http://127.0.0.1:8000/index.html")) {
        std::cerr << "无法打开浏览器地址: http://127.0.0.1:8000/index.html\n";
        return 3;
    }

    return 0;
}
