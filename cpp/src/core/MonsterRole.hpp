#pragma once

#include <array>
#include <cstdint>
#include <string>

#include "core/Types.hpp"

namespace core {

class MonsterRole {
public:
    struct Stats {
        std::int32_t maxHp = 300;
        std::int32_t attackPower = 20;
    };

    struct AttackProfile {
        std::string name;
        std::int32_t rangeRadius = 1;
        std::int32_t cooldownMs = 1000;
        std::int32_t variants = 2;
    };

    struct VisionProfile {
        // 5x5 means radius 2 around monster center tile.
        std::int32_t discoverRadius = 2;
    };

    struct SkillProfile {
        std::string name;
        bool enabled = false;
    };

    static MonsterRole goblin();
    static MonsterRole goblinKing();

    [[nodiscard]] const std::string& displayName() const;
    [[nodiscard]] const Stats& stats() const;
    [[nodiscard]] const AttackProfile& normalAttack() const;
    [[nodiscard]] const VisionProfile& vision() const;
    [[nodiscard]] const SkillProfile& skill() const;

private:
    std::string displayName_;
    Stats stats_;
    AttackProfile normalAttack_;
    VisionProfile vision_;
    SkillProfile skill_;
};

} // namespace core
