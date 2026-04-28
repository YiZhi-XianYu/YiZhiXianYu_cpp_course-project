#include "core/CharacterRole.hpp"

namespace core {

CharacterRole CharacterRole::plainPhysicalMage() {
    CharacterRole role{};
    role.kind_ = RoleKind::PlainPhysicalMage;
    role.displayName_ = "平平无奇的物理魔法使";
    role.stats_.maxHp = 300;
    role.stats_.attackPower = 50;
    role.normalAttack_.name = "近战单体斩击";
    role.normalAttack_.rangeTiles = 1;
    role.normalAttack_.autoLock = true;
    role.normalAttack_.hasAreaEffect = false;
    role.smallSkill_.name = "小技能";
    role.smallSkill_.enabled = true;
    role.bigSkill_.name = "大技能";
    role.bigSkill_.enabled = true;
    return role;
}

CharacterRole CharacterRole::legendaryLineArcher() {
    CharacterRole role{};
    role.kind_ = RoleKind::LegendaryLineArcher;
    role.displayName_ = "只射直线的传奇弓箭手";
    role.stats_.maxHp = 300;
    role.stats_.attackPower = 50;
    role.normalAttack_.name = "直线发射箭矢";
    role.normalAttack_.rangeTiles = 10;
    role.normalAttack_.autoLock = false;
    role.normalAttack_.hasAreaEffect = false;
    role.smallSkill_.name = "小技能";
    role.smallSkill_.enabled = true;
    role.bigSkill_.name = "大技能";
    role.bigSkill_.enabled = true;
    return role;
}

const std::string& CharacterRole::displayName() const {
    return displayName_;
}

RoleKind CharacterRole::kind() const {
    return kind_;
}

const CharacterRole::Stats& CharacterRole::stats() const {
    return stats_;
}

const CharacterRole::AttackProfile& CharacterRole::normalAttack() const {
    return normalAttack_;
}

const CharacterRole::SkillProfile& CharacterRole::smallSkill() const {
    return smallSkill_;
}

const CharacterRole::SkillProfile& CharacterRole::bigSkill() const {
    return bigSkill_;
}

bool CharacterRole::skillEnabled(SkillSlot slot) const {
    if (slot == SkillSlot::Small) {
        return smallSkill_.enabled;
    }

    return bigSkill_.enabled;
}

} // namespace core