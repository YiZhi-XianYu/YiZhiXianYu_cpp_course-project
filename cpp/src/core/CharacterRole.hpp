#pragma once

#include <array>
#include <cstdint>
#include <string>

namespace core {

enum class SkillSlot {
    Small,
    Big
};

enum class RelativeDirection {
    Front,
    Left,
    Right,
    Back
};

class CharacterRole {
public:
    struct Stats {
        std::int32_t maxHp = 300;
        std::int32_t attackPower = 50;
    };

    struct AttackProfile {
        std::string name;
        std::int32_t rangeTiles = 1;
        bool autoLock = true;
        bool hasAreaEffect = false;
        std::array<RelativeDirection, 4> targetPriority {
            RelativeDirection::Front,
            RelativeDirection::Left,
            RelativeDirection::Right,
            RelativeDirection::Back
        };
    };

    struct SkillProfile {
        std::string name;
        bool enabled = false;
    };

    static CharacterRole plainPhysicalMage();

    [[nodiscard]] const std::string& displayName() const;
    [[nodiscard]] const Stats& stats() const;
    [[nodiscard]] const AttackProfile& normalAttack() const;
    [[nodiscard]] const SkillProfile& smallSkill() const;
    [[nodiscard]] const SkillProfile& bigSkill() const;
    [[nodiscard]] bool skillEnabled(SkillSlot slot) const;

private:
    std::string displayName_;
    Stats stats_;
    AttackProfile normalAttack_;
    SkillProfile smallSkill_;
    SkillProfile bigSkill_;
};

} // namespace core