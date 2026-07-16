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
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'
import { agentGlobalSkillTable } from '@main/data/db/schemas/agentGlobalSkill'

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
      {
        table: table('agent_global_skill'),
        column: column('tags'),
        reason: 'no soft refs — holds freeform skill tag strings'
      }
    ]
  },
  backupPolicy: {},
  // SKILLS is schema-only for marketplace/builtin skills (re-fetchable: marketplace
  // via sourceUrl re-clone, builtin via app-bundle reinstall on startup). Only
  // zip/local skills (sourceUrl=null, user-provided, NON-re-downloadable) carry
  // on-disk content that MUST be archived. TBD-1 (iii): full preset collects their
  // directory (skill-dir); lite preset keeps schema only but records each omission
  // via ctx.recordDegraded (manifest.degraded + logger, never silently lost). Reads
  // the backup.sqlite SNAPSHOT (ctx.liveDb), not the live AgentGlobalSkillService,
  // so the collected set agrees with the archived DB. Filtering is by `source`, NOT
  // sourceUrl===null (builtin rows also have null sourceUrl).
  operations: {
    collectFileResources: async (ctx) => {
      // select() returns all columns (BackupReadonlyDb exposes the no-arg select);
      // we read only folderName/source/contentHash per row below.
      const rows = await ctx.liveDb.select().from(agentGlobalSkillTable)
      const descriptors: { kind: 'skill-dir'; folderName: string; contentHash: string }[] = []
      for (const r of rows) {
        if (r.source !== 'zip' && r.source !== 'local') continue
        if (ctx.preset === 'full') {
          descriptors.push({ kind: 'skill-dir', folderName: r.folderName, contentHash: r.contentHash })
        } else {
          // lite: skill content omitted — record the degradation so it is observable
          ctx.recordDegraded({
            kind: 'skill-dir-omitted-lite',
            folderName: r.folderName,
            contentHash: r.contentHash
          })
        }
      }
      return descriptors
    }
  }
})
