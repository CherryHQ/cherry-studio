// PROMPTS backup contributor — owns the `prompt` table (uuid-v4 PK).
//
// Co-located in the prompts owning module (PromptService lives in this flat
// data-services dir) per backup-architecture §7 / contributor-framework
// "contributor placement" — domain facts stay with the domain, never centralized
// in the backup module. Schema-only domain: no aggregate members, no operations
// hooks, no file/JSON soft-refs (see openspec simple-domains.md "PROMPTS").
//
// Preset: full + lite.

import type { BackupContributor } from '@main/data/db/backup/contributor-types'
import { columns, DB_PRIMARY_KEYS, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * Mirror a codegen PK fact with `ambiguous` confirmed false — the contributor
 * acknowledges every owned table's primary key, satisfying finalize #8 (PK fact
 * per owned table) and #9 (non-ambiguous). Spreading the codegen value keeps the
 * declared fact in lockstep with the generated schema (no retyping).
 */
const pk = (t: Parameters<typeof table>[0]) => ({ ...DB_PRIMARY_KEYS[t], ambiguous: false as const })

/**
 * PROMPTS domain: user-authored prompt library. Single table, uuid-v4 PK, no
 * cross-domain references, no aggregate members. conflictDefault derives to SKIP
 * (uuid-entity → SKIP, §6.2); omitted here as it is the derived default.
 */
export const PROMPTS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'PROMPTS',
  schema: {
    tables: [table('prompt')],
    references: [],
    primaryKeys: [pk('prompt')],
    aggregates: [{ root: table('prompt'), identityKey: columns(['id']), members: [], renamable: false }],
    fileRefSourcePolicies: [],
    jsonSoftReferences: []
  },
  backupPolicy: { uniqueMergeRules: [] },
  operations: undefined
})
