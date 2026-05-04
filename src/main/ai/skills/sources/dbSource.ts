/**
 * DB-backed skill source — delegates to `SkillService.listEnabledGlobal`.
 * The AI layer never touches the table directly; SkillService owns the
 * agent_global_skill / agent_skill schema and exposes a typed read
 * method we map onto the catalog's `Skill` shape.
 *
 * For Phase F v1 the row carries metadata only (no body). Filesystem
 * sources scan the same skill folders for body content; the catalog
 * merger dedupes by name so a workspace folder of the same skill
 * shadows the DB metadata-only entry.
 */

import { skillService } from '@main/services/agents/skills/SkillService'
import type { InstalledSkill } from '@types'

import type { Skill } from '../types'

export async function dbSource(): Promise<Skill[]> {
  const rows = await skillService.listEnabledGlobal()
  return rows.map(toSkill)
}

function toSkill(row: InstalledSkill): Skill {
  return {
    id: `db::${row.name}`,
    name: row.name,
    description: row.description ?? '',
    body: '',
    source: 'db',
    path: `db://${row.id}`,
    contentHash: row.contentHash
  }
}
