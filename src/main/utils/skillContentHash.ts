import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { findSkillMdPath } from './markdownParser'

/**
 * Compute the SHA-256 hash used by the skill registry from SKILL.md content only.
 * Returns null when the skill descriptor is absent so callers can classify it as degraded.
 */
export async function computeSkillContentHash(skillDir: string): Promise<string | null> {
  const skillMdPath = await findSkillMdPath(skillDir)
  if (!skillMdPath) return null

  const content = await readFile(skillMdPath, 'utf-8')
  return createHash('sha256').update(content).digest('hex')
}
