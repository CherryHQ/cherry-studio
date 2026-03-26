/**
 * Skill entity types
 *
 * Skills are reusable instruction sets that can be assigned to agents.
 * They are stored as directories containing a SKILL.md file.
 */

export type SkillSource = 'builtin' | 'project' | 'marketplace' | 'local' | 'zip'

/**
 * Complete skill entity as returned by the API
 */
export interface Skill {
  id: string
  name: string
  slug: string
  description?: string | null
  author?: string | null
  version?: string | null
  tags?: string[] | null
  tools?: string[] | null

  source: SkillSource
  sourcePath: string
  packageName?: string | null
  packageVersion?: string | null
  marketplaceId?: string | null

  contentHash?: string | null
  size?: number | null

  isEnabled: boolean

  versionDirPath?: string | null

  createdAt: string
  updatedAt: string
}

/**
 * Skill version history entry
 */
export interface SkillVersion {
  id: string
  skillId: string
  version?: string | null
  contentHash: string
  diffPath: string
  message?: string | null
  createdAt: string
  updatedAt: string
}
