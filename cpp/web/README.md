# Build C++ Web Core (WASM)

本目录用于放置由 Emscripten 生成的前端可调用模块：

- `game_core.js`
- `game_core.wasm`

## 构建命令

在项目根目录执行：

```powershell
emcc cpp/src/web/GameCoreBridge.cpp cpp/src/core/PlayerController.cpp cpp/src/core/CameraController.cpp \
  -Icpp/src \
  -O2 \
  -sEXPORTED_FUNCTIONS=["_malloc","_free","_gc_init","_gc_set_world","_gc_set_viewport","_gc_set_collision_grid","_gc_set_spawn","_gc_center_camera","_gc_request_move","_gc_request_attack","_gc_update","_gc_player_tile_x","_gc_player_tile_y","_gc_player_world_x","_gc_player_world_y","_gc_player_facing_x","_gc_player_is_walking","_gc_player_is_moving","_gc_player_is_attacking","_gc_player_attack_variant","_gc_camera_x","_gc_camera_y"] \
  -sEXPORTED_RUNTIME_METHODS=["cwrap"] \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createGameCoreModule \
  -o cpp/web/game_core.js
```

构建完成后，`soldier-idle-test.html` 会通过 `js/cpp-runtime.js` 调用该模块，把角色移动与镜头逻辑交给 C++。
