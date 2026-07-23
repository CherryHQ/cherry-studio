// FtsCentralHelper — single owner of the FTS5 external-content rebuild + integrity-check
// SQL on the detached work.sqlite. The architecture (§9 step 3) assigns FTS rebuild to
// per-domain `afterImport` hooks; those hooks DELEGATE the central SQL here (DRY — no
// per-domain raw SQL, no nonexistent Service API). Stage 4 calls it directly from the
// MergeEngine pipeline (engine-internal; the hook delegation lands with Stage 3 wiring).
//
// Driven by `DB_FTS_VIRTUAL_TABLES = { message_fts: 'message', agent_session_message_fts:
// 'agent_session_message' }`. Single-row AFTER-INSERT triggers can't backstop a bulk merge
// (an `INSERT OR IGNORE` skip, or a fts_rowid collision reassigned by the trigger, leaves
// the FTS index stale), so a whole-index rebuild after importRows is the consistency backstop.

import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import { DB_FTS_VIRTUAL_TABLES } from '@main/data/db/backup/dbSchemaRefs'
import type Database from 'better-sqlite3'

/** FTS5 external-content integrity check failed — work.sqlite MUST NOT promote. */
export class FtsIntegrityCheckError extends Error {
  constructor(ftsTable: string, detail: string) {
    super(`FTS integrity-check failed for '${ftsTable}': ${detail}`)
    this.name = 'FtsIntegrityCheckError'
  }
}

/**
 * FtsCentralHelper — rebuild + integrity-check for every FTS5 external-content virtual table
 * on work.sqlite. Both run inside the merge transaction. Every entry in
 * `DB_FTS_VIRTUAL_TABLES` is a required schema object: a missing FTS table means work.sqlite
 * is structurally incomplete (no usable search index), so the helper lets the `prepare` throw
 * "no such table" and the merge tx rolls back (fail-closed) rather than silently skipping it.
 */
export const FtsCentralHelper = {
  /**
   * Rebuild every FTS index from its external content table. The FTS5 special command
   * `'rebuild'` resyncs the whole index from the content rows, so re-running on an
   * already-consistent index is a no-op (idempotent). Run AFTER importRows + the junction
   * phase so the index reflects the final merged content.
   */
  rebuild(work: Database.Database): void {
    for (const fts of Object.keys(DB_FTS_VIRTUAL_TABLES) as DbTableName[]) {
      // FTS5 special INSERT: the (fts) column is the virtual table's same-named hidden column;
      // 'rebuild' discards the current index and rebuilds it from the external content table.
      // A missing fts table throws here → the merge tx rolls back (fail-closed).
      work.prepare(`INSERT INTO ${fts} (${fts}) VALUES ('rebuild')`).run()
    }
  },

  /**
   * Assert every FTS index is consistent with its content table. The FTS5 special command
   * `'integrity-check'` (rank = bucket count, 1 = single bucket) throws SQLITE_CORRUPT_VTAB
   * ("database disk image is malformed") on a mismatch — orphan FTS row, missing content row,
   * or stale content — and silently succeeds when consistent. Catch + rethrow as
   * FtsIntegrityCheckError. better-sqlite3 flags this special INSERT `reader: false`, so it
   * MUST run via `.run()` (consistent → no output; inconsistent → throws), not `.all()`.
   */
  integrityCheck(work: Database.Database): void {
    for (const fts of Object.keys(DB_FTS_VIRTUAL_TABLES) as DbTableName[]) {
      try {
        work.prepare(`INSERT INTO ${fts} (${fts}, rank) VALUES ('integrity-check', 1)`).run()
      } catch (err) {
        throw new FtsIntegrityCheckError(fts, (err as Error).message ?? String(err))
      }
    }
  }
}
