// SKILLS backup contributor — owns the `agent_global_skill` table.
//
// Co-located in the skills owning module (AgentGlobalSkillService lives in this
// flat data-services dir) per backup-architecture §7 placement. `agent_global_skill`
// is the USER-ENABLED global skill registry — distinct from AGENTS' `agent_skill`
// junction (which maps agents→skills and belongs to AGENTS). Schema-only domain:
// no cross-domain references, no aggregate members, no operations hooks.
//
// Preset: full + lite.

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * SKILLS domain: globally-enabled skills, keyed by the UNIQUE `folderName`. Per
 * §6.2 the UNIQUE non-PK key wins over the uuid-v4 physical PK, so identityKey is
 * `folderName`, identityClass is natural-key, conflictDefault FIELD_MERGE (aligns
 * the same skill across devices; local UUID wins on collision).
 */
export const SKILLS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'SKILLS',
  schema: {
    tables: [table('agent_global_skill')],
    references: [],
    primaryKeys: [mirrorPk('agent_global_skill')],
    aggregates: [
      {
        root: table('agent_global_skill'),
        identityKey: columns(['folderName']),
        identityClass: 'natural-key',
        conflictDefault: 'FIELD_MERGE',
        members: [],
        renamable: false
      }
    ],
    fileRefSourcePolicies: [],
    jsonSoftReferences: [],
    // agent_global_skill.tags holds freeform tag strings — no embedded
    // fileId/entityId soft refs. Declared so finalize #12 exhaustiveness passes.
    exemptJsonCols: [
      { table: table('agent_global_skill'), column: column('tags'), reason: 'no soft refs — holds freeform skill tag strings' }
    ]
  },
  backupPolicy: {},
  // TODO(C/D track + spec clarification): the domain spec marks SKILLS schema-only
  // (no file resources), but SkillService reads + symlinks skill content from the directory
  // {userData}/feature.agents.skills/{folderName}. A schema-only restore re-creates the
  // agent_global_skill ROW but leaves that directory absent → file reads + agent skill
  // reconciliation point at a missing folder (codex review P2). Resolve before the
  // restore pipeline consumes this contributor: (a) if skill folders are regenerable
  // from `sourceUrl` (git/URL skills) the row alone suffices — confirm + document it;
  // (b) if user-authored skills (no sourceUrl) keep content only on disk, SKILLS needs
  // a collectFileResources/restoreResources hook to archive + restore the folder.
  // Needs SKILLS-owner + spec confirmation; not a finalize concern.
  operations: undefined
})
