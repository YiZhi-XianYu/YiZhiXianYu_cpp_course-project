cmake_minimum_required(VERSION 3.20)
project(TileGameCore LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_executable(tile_game_demo
    src/main.cpp
    src/core/CharacterRole.cpp
    src/core/MonsterRole.cpp
    src/core/PlayerController.cpp
    src/core/MonsterController.cpp
    src/core/CameraController.cpp
)

target_include_directories(tile_game_demo PRIVATE src)
