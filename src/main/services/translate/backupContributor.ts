// TRANSLATE_HISTORY backup contributor — owns `translate_language` + `translate_history`.
//
// Co-located in the translate owning module (translateService lives here) per
// backup-architecture §7 placement. Two INDEPENDENT aggregates (NOT a
// member relationship): translate_history rows carry their own uuid-v7 id and
// may reference zero/one/two languages, so they are not owned by a langCode root
// — treating them as a member would wrongly drop history rows on langCode-group
// SKIP/FIELD_MERGE (see openspec simple-domains.md "TRANSLATE_HISTORY").
//
// Preset: full only (history excluded from lite).

import type { BackupContributor } from '@main/data/db/backup/contributor-types'
import { column, columns, DB_PRIMARY_KEYS, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/** Mirror a codegen PK fact with `ambiguous` confirmed false (finalize #8/#9). */
const pk = (t: Parameters<typeof table>[0]) => ({ ...DB_PRIMARY_KEYS[t], ambiguous: false as const })

/**
 * TRANSLATE_HISTORY domain. `translate_language` is a natural-key singleton set
 * (langCode); `translate_history` is a uuid-entity log whose sourceLanguage /
 * targetLanguage FKs are optional (set null) — same-domain references that stay
 * optional so a history row survives a missing language (SET_NULL, not DELETE_ROW).
 */
export const TRANSLATE_HISTORY_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'TRANSLATE_HISTORY',
  schema: {
    tables: [table('translate_language'), table('translate_history')],
    references: [
      {
        table: table('translate_history'),
        column: column('sourceLanguage'),
        referencedDomain: 'TRANSLATE_HISTORY',
        kind: 'optional'
      },
      {
        table: table('translate_history'),
        column: column('targetLanguage'),
        referencedDomain: 'TRANSLATE_HISTORY',
        kind: 'optional'
      }
    ],
    primaryKeys: [pk('translate_language'), pk('translate_history')],
    aggregates: [
      {
        root: table('translate_language'),
        identityKey: columns(['langCode']),
        identityClass: 'natural-key',
        conflictDefault: 'FIELD_MERGE',
        members: [],
        renamable: false
      },
      { root: table('translate_history'), identityKey: columns(['id']), members: [], renamable: false }
    ],
    fileRefSourcePolicies: [],
    jsonSoftReferences: []
  },
  backupPolicy: { uniqueMergeRules: [] },
  operations: undefined
})
