import type { InstalledSkill } from '@shared/data/types/agent'

export function getCreateSkillIds(
  skills: readonly InstalledSkill[],
  skillIds?: string[],
  disabledSkillIds?: string[]
): string[] {
  if (skillIds !== undefined) return skillIds

  const disabled = new Set(disabledSkillIds)
  return skills
    .filter((skill) => skill.isGlobalEnabled && skill.source !== 'builtin' && !disabled.has(skill.id))
    .map((skill) => skill.id)
}
