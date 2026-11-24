import type { InstalledSkill } from '@shared/data/api/schemas/skills'

import { normalizeFolderKey } from './skillPaths'

/** Bundled skills whose tools only exist inside Cherry; never project them to ~/.agents/skills. */
export const CHERRY_RUNTIME_ONLY_BUILTIN_SKILLS = ['cherry-browser', 'cherry-computer', 'cherry-tool-guide'] as const

const CHERRY_RUNTIME_ONLY = new Set<string>(CHERRY_RUNTIME_ONLY_BUILTIN_SKILLS)

/** Only trusted builtins with an exact case-insensitive folder name are withheld from external export. */
export function isSkillExternallyExportable(skill: Pick<InstalledSkill, 'source' | 'folderName'>): boolean {
  if (skill.source !== 'builtin') return true
  return !CHERRY_RUNTIME_ONLY.has(normalizeFolderKey(skill.folderName))
}
