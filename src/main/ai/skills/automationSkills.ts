import type { InstalledSkill } from '@shared/data/api/schemas/skills'

export function isAutomationSkillAvailable(
  skill: Pick<InstalledSkill, 'source' | 'folderName'>,
  access: { browser: boolean; computer: boolean }
): boolean {
  if (skill.source !== 'builtin') return true
  if (skill.folderName === 'cherry-browser') return access.browser
  if (skill.folderName === 'cherry-computer') return access.computer
  return true
}
