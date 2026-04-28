#include "core/MonsterRole.hpp"

namespace core {

MonsterRole MonsterRole::goblin() {
    MonsterRole role{};
    role.displayName_ = "哥布林";
    role.stats_.maxHp = 300;
    role.stats_.attackPower = 20;
    role.normalAttack_.name = "哥布林重击";
    role.normalAttack_.rangeRadius = 1;
    role.normalAttack_.cooldownMs = 1000;
    role.normalAttack_.variants = 2;
    role.vision_.discoverRadius = 2;
    return role;
}

MonsterRole MonsterRole::goblinKing() {
    MonsterRole role{};
    role.displayName_ = "哥布林大王";
    role.stats_.maxHp = 1500;
    role.stats_.attackPower = 30;
    role.normalAttack_.name = "大王重击";
    role.normalAttack_.rangeRadius = 1;
    role.normalAttack_.cooldownMs = 1200;
    role.normalAttack_.variants = 2;
    role.vision_.discoverRadius = 3;
    role.skill_.name = "技能";
    role.skill_.enabled = true;
    return role;
}

const std::string& MonsterRole::displayName() const {
    return displayName_;
}

const MonsterRole::Stats& MonsterRole::stats() const {
    return stats_;
}

const MonsterRole::AttackProfile& MonsterRole::normalAttack() const {
    return normalAttack_;
}

const MonsterRole::VisionProfile& MonsterRole::vision() const {
    return vision_;
}

const MonsterRole::SkillProfile& MonsterRole::skill() const {
    return skill_;
}

} // namespace core
