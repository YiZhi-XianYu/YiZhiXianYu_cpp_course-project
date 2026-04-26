# C++ Core Skeleton

当前目录保留了可复用的 C++ 控制器代码，同时 `main.cpp` 已按现状改为仅启动网页入口。

已包含：

- 默认职业「平平无奇的物理魔法使」的角色配置
- 角色按格请求移动 + 平滑插值过渡
- 左右朝向切换
- 移动中输入排队
- 相机死区跟随（含上下不对称阈值）

## 目录

- `src/core/CharacterRole.*`：角色/职业基础数据
- `src/core/PlayerController.*`：角色移动与朝向
- `src/core/CameraController.*`：镜头跟随
- `src/main.cpp`：仅打开项目根目录 `index.html`
- `src/web/GameCoreBridge.cpp`：给前端调用的 C++ WASM 导出接口

## 构建

```powershell
cd cpp
cmake -S . -B build
cmake --build build --config Release
```

可执行文件名：`tile_game_demo`

运行后行为：

- 自动查找并打开项目根目录下的 `index.html`
- 启动时会先自动执行 `cpp/build_game_wasm.ps1`，构建 `cpp/web/game_core.js` 与 `cpp/web/game_core.wasm`
- 不在 C++ 可执行程序内运行地图/角色逻辑

## 当前架构说明

- 网页游戏逻辑仍在前端文件中运行（`index.html` / `map01.html` / `start.js`）
- C++ 入口程序仅作为启动器
- `src/core` 下控制器代码作为后续迁移储备，当前不作为运行入口

## 前端调用 C++ 逻辑

`map01.html` 已切换为通过 WASM 调用 C++ 的移动与镜头逻辑。

构建方式见：`cpp/web/README.md`

## 下一步如何接成完整 C++ 游戏

1. 选择渲染库：推荐 SDL2 或 raylib。
2. 把输入层映射到 `PlayerController::requestMove(dx, dy, nowMs, isBlocked)`。
3. 每帧更新：
   - `player.update(nowMs, isBlocked)`
   - `camera.updateFollow(player.worldPos(), bounds)`
4. 渲染层根据状态绘制：
   - 角色位置：`player.worldPos()`
   - 朝向：`player.facing()`
   - 动画状态：`player.isWalkingAnimation()`
   - 相机偏移：`camera.position()`

默认职业配置：

- 名称：`平平无奇的物理魔法使`
- 血量：`300`
- 攻击力：`50`
- 普攻：近战单体斩击，自动锁敌，优先级为前方、左侧、右侧、后方
- 小技能：暂未开放
- 大技能：暂未开放

## 地图复用建议

后续增加地图时，不需要改 Player 或 Camera，只要提供：

- 地图世界尺寸（worldWidth/worldHeight）
- 视口尺寸（viewportWidth/viewportHeight）
- 阻挡查询函数 `isBlocked(x, y)`
- 出生点 `setSpawn(tilePos)`
