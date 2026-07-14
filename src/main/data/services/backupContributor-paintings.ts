// PAINTINGS backup contributor — owns `painting` + `painting_file_ref`.
//
// Co-located in the paintings owning module (PaintingService lives in this flat
// data-services dir) per backup-architecture §7 placement. painting is the
// aggregate root; painting_file_ref is an include member via sourceId
// (onDelete cascade). painting_file_ref is a junction with a second cascade FK
// fileEntryId→file_entry (FILE_STORAGE) — a cross-domain owning reference, NOT a
// member of the painting aggregate (§5.1: post-#16532 painting_file_ref belongs to
// PAINTINGS by source domain; FILE_STORAGE owns file_entry only).
//
// painting has NO FKs (providerId/modelId are scalar soft refs pointing at DB rows
// without a declared FK — per §5.4 three-way scalar-ID rule, these are NOT
// EntityReferences; they stay tolerant: missing target degrades, no rewrite).
//
// renamable:false — paintings are uuid-entity with no business UNIQUE key; RENAME
// is not applicable (architecture §3.5).
//
// Preset: full only (lite-excluded — painting images are large file blobs).

import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { column, columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'

/**
 * PAINTINGS domain. painting (uuid-v4) is the aggregate root; painting_file_ref
 * (uuid-v4) is an include member via sourceId. painting_file_ref.fileEntryId→
 * file_entry is a cross-domain owning reference (cascade). conflictDefault
 * derives to SKIP (uuid-entity → SKIP, §6.2).
 */
export const PAINTINGS_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'PAINTINGS',
  schema: {
    tables: [table('painting'), table('painting_file_ref')],
    references: [
      // painting_file_ref.sourceId → painting: same-domain owning (cascade). Drives
      // the aggregate membership (#14/#15) and is #25-required.
      { table: table('painting_file_ref'), column: column('sourceId'), referencedDomain: 'PAINTINGS', kind: 'owning' },
      // painting_file_ref.fileEntryId → file_entry (FILE_STORAGE): junction (dual-cascade
      // junction table — sourceId & fileEntryId both onDelete cascade). Cross-domain
      // endpoint, cascade-prune not DELETE_ROW; mirrors TOPICS chat_message_file_ref.fileEntryId
      // per §5.2. #25-required (declare so the FK is covered; finalize #19 verifies cascade).
      {
        table: table('painting_file_ref'),
        column: column('fileEntryId'),
        referencedDomain: 'FILE_STORAGE',
        kind: 'junction'
      }
    ],
    primaryKeys: [mirrorPk('painting'), mirrorPk('painting_file_ref')],
    aggregates: [
      {
        root: table('painting'),
        identityKey: columns(['id']),
        members: [{ table: table('painting_file_ref'), viaColumn: column('sourceId'), cascade: 'include' }],
        renamable: false
      }
    ],
    // file_ref.sourceType='painting' → ownerDomain=PAINTINGS (finalize #11). Drives
    // export-time file blob collection via painting_file_ref (§5.1).
    fileRefSourcePolicies: [
      {
        sourceType: 'painting',
        ownerDomain: 'PAINTINGS',
        resourcePolicy: 'include-with-owner',
        sourceTable: table('painting_file_ref')
      }
    ],
    jsonSoftReferences: []
  },
  backupPolicy: {},
  // TODO(C/D track) — collectFileResources (export painting file blobs via
  // painting_file_ref.fileEntryId, filter deletedAt IS NULL) + restoreResources
  // (blob restore runs before DB import, returns skippedFileEntryIds). Not a
  // finalize concern; wired with the C/D restore track (like FILE_STORAGE / KNOWLEDGE).
  operations: undefined
})
