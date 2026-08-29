// TRANSLATE_HISTORY backup contributor — owns `translate_language` + `translate_history`.
//
// Co-located in the translate owning module (translateService lives here) per
// backup-architecture §7 placement. Two INDEPENDENT aggregates (NOT a
// member relationship): translate_history rows carry their own uuid-v7 id and
// may reference zero/one/two languages, so they are not owned by a langCode root
// — treating them as a member would wrongly drop history rows on langCode-group
// SKIP/FIELD_MERGE.
//
// Preset: full only (history excluded from lite).

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * TRANSLATE_HISTORY domain. `translate_language` is a natural-key singleton set
 * (langCode); `translate_history` is a uuid-entity log whose sourceLanguage /
 * targetLanguage FKs are optional (set null) — same-domain references that stay
 * optional so a history row survives a missing language (SET_NULL, not DELETE_ROW).
 */
export const TRANSLATE_HISTORY_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'TRANSLATE_HISTORY',
  schema: {
    tables: [table('translate_language'), table('translate_history'), table('translate_history_file_ref')],
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
      },
      // translate_history_file_ref.sourceId → translate_history: same-domain owning
      // (cascade) — nested include member so layout artifacts follow their history row.
      {
        table: table('translate_history_file_ref'),
        column: column('sourceId'),
        referencedDomain: 'TRANSLATE_HISTORY',
        kind: 'owning'
      },
      // translate_history_file_ref.fileEntryId → file_entry (FILE_STORAGE): cross-domain
      // junction (cascade-prune with FILE_STORAGE), same shape as chat_message_file_ref.
      {
        table: table('translate_history_file_ref'),
        column: column('fileEntryId'),
        referencedDomain: 'FILE_STORAGE',
        kind: 'junction'
      }
    ],
    primaryKeys: [
      mirrorPk('translate_language'),
      mirrorPk('translate_history'),
      mirrorPk('translate_history_file_ref')
    ],
    aggregates: [
      {
        root: table('translate_language'),
        identityKey: columns(['langCode']),
        identityClass: 'natural-key',
        conflictDefault: 'FIELD_MERGE',
        members: [],
        renamable: false
      },
      {
        root: table('translate_history'),
        identityKey: columns(['id']),
        members: [{ table: table('translate_history_file_ref'), viaColumn: column('sourceId'), cascade: 'include' }],
        renamable: false
      }
    ],
    // Layout-preserving PDF translations persist a Cherry-owned artifact
    // (role='target', delete_when_unreferenced) alongside the history row — same
    // collection-ref shape as painting/chat_message, so the artifact bundles
    // with its owning domain. role='source' refs are external files (never copied).
    fileRefSourcePolicies: [
      { sourceType: 'translate_history', ownerDomain: 'TRANSLATE_HISTORY', resourcePolicy: 'include-with-owner' }
    ],
    jsonSoftReferences: []
  },
  backupPolicy: {},
  operations: undefined
})
