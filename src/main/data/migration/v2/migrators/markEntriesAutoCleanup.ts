import { fileEntryTable } from '@data/db/schemas/file'
import type { DbOrTx } from '@data/db/types'
import { inArray } from 'drizzle-orm'

/** Ids per UPDATE … IN (…) statement — stays well under SQLite's bound-parameter cap. */
const UPDATE_CHUNK_SIZE = 500

/**
 * Flip already-inserted `file_entry` rows to `cleanup_policy =
 * 'delete_when_unreferenced'` (file-entry-cleanup.md §7.2 — classification by
 * reference state).
 *
 * This is an UPDATE by design, not a value the ref-row inserts could carry:
 * `cleanup_policy` is a `file_entry` column, while the chat/painting migrators
 * insert into their *ref* tables — the entry rows themselves were inserted
 * earlier by FileMigrator (as `'manual'`), before referenced-ness is known.
 * Idempotent, so a retried batch (or a ref insert skipped by
 * `onConflictDoNothing`) is safe. Call inside the same transaction as the ref
 * inserts so referenced-ness and policy commit atomically.
 */
export function markEntriesAutoCleanup(tx: DbOrTx, entryIds: Iterable<string>): void {
  const ids = [...new Set(entryIds)]
  for (let i = 0; i < ids.length; i += UPDATE_CHUNK_SIZE) {
    tx.update(fileEntryTable)
      .set({ cleanupPolicy: 'delete_when_unreferenced' })
      .where(inArray(fileEntryTable.id, ids.slice(i, i + UPDATE_CHUNK_SIZE)))
      .run()
  }
}
