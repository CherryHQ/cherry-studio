// FILE_STORAGE backup contributor — owns the `file_entry` table (uuid-v7 PK).
//
// Co-located in the file owning module (FileEntryService lives in this flat
// data-services dir) per backup-architecture §7 placement. Schema-only at the
// declaration level: file_entry has no FKs and no business UNIQUE key. (It does
// carry a `lower(externalPath)` expression unique index, but expression indexes
// can't be codegen-reflected — and file_entry is uuid-entity, so finalize #13
// exempts it from unique-backing anyway.)
//
// Post-#16532 the old polymorphic `file_ref` table was split into
// `chat_message_file_ref` (→ TOPICS, by sourceId→message) and `painting_file_ref`
// (→ PAINTINGS, by sourceId→painting). Those junctions belong to their SOURCE
// domains, NOT FILE_STORAGE — so this contributor owns file_entry only.
//
// Internal blob bytes (origin='internal', under feature.files.data) are file
// resources staged into the archive. External rows (absolute externalPath) are
// dangling by design (architecture §5.1) — schema-only on export; no blob copy.
// restoreResources must still run before DB import on restore (C/D track TODO,
// like MCP_SERVERS dxtPath) to rehydrate whatever the archive carries.
//
// Preset: full only (lite-excluded — files are large blobs).

import type { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import type { BackupContributor } from '@main/data/db/backup/contributorTypes'
import { columns, mirrorPk, table } from '@main/data/db/backup/dbSchemaRefs'
import { deepFreeze } from '@main/data/db/backup/freeze'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * Collect ids of non-soft-deleted **internal** file_entry rows — the export blob
 * set. Aligns with BackupService.sumInternalBlobBytes (origin='internal' only):
 * external entries are not staged (dangling by design; architecture §5.1 L196).
 * Staging (ExportOrchestrator step 4) resolves each id under feature.files.data
 * and skips any that are missing/unreadable rather than failing the whole export.
 */
export async function collectFileEntryIds(liveDb: BackupReadonlyDb): Promise<Set<string>> {
  const rows = await liveDb
    .select()
    .from(fileEntryTable)
    .where(and(eq(fileEntryTable.origin, 'internal'), isNull(fileEntryTable.deletedAt)))
  return new Set(rows.map((r) => r.id))
}

/**
 * FILE_STORAGE domain: user file entries. Single table, uuid-v7 PK, no FKs, no
 * cross-domain references. conflictDefault derives to SKIP (uuid-entity → SKIP, §6.2).
 */
export const FILE_STORAGE_CONTRIBUTOR = deepFreeze<BackupContributor>({
  domain: 'FILE_STORAGE',
  schema: {
    tables: [table('file_entry')],
    references: [],
    primaryKeys: [mirrorPk('file_entry')],
    aggregates: [{ root: table('file_entry'), identityKey: columns(['id']), members: [], renamable: false }],
    fileRefSourcePolicies: [],
    jsonSoftReferences: []
  },
  backupPolicy: {},
  // TODO(C/D track) — restoreResources + externalPath/content dedup. Two restore-track
  // concerns (neither is a finalize concern):
  //  1. Blob restore: restoreResources (externalPath/size) runs before DB import and
  //     returns skippedFileEntryIds for entries whose blob is unavailable; without it a
  //     schema-only restore re-creates the row but not the blob → broken file on a new
  //     machine (like MCP_SERVERS dxtPath).
  //  2. UNIQUE-on-externalPath dedup (codex review): file_entry carries a
  //     `lower(externalPath)` expression unique index that codegen CANNOT reflect (so
  //     DB_UNIQUE_KEYS.file_entry is empty and finalize #13 exempts it — correct at the
  //     declaration level). But SQLite still enforces it at restore time: as a
  //     uuid-entity (conflictDefault SKIP by id), two rows sharing the same
  //     lower(externalPath) but different ids are NOT detected as an aggregate conflict,
  //     so a full restore into a profile that already has that path under a different id
  //     UNIQUE-violates at insert/commit and rolls back the whole restore. The importer
  //     MUST pre-scan/dedup file_entry by lower(externalPath) (external files) and by
  //     content_hash (internal files, #15445) before import — skip/map duplicates rather
  //     than relying on id-level SKIP. Add a collision test (same lower(externalPath),
  //     different ids) when wiring restore.
  //  The temp_session/chat_message/painting FileRefSourceType coverage (#11) lands with
  //  their source domains (TOPICS/PAINTINGS) + a temp_session runtime-owner, not here.
  operations: {
    // Export blob set = non-deleted internal file_entry ids only. External rows
    // are not collected (dangling by design). Staging resolves each id under
    // feature.files.data and copies the blob into files/<id>; a missing source
    // is skipped, not fatal.
    collectFileResources: async (ctx) =>
      [...(await collectFileEntryIds(ctx.liveDb))].map((fileEntryId) => ({ kind: 'file-entry' as const, fileEntryId }))
  }
})
