// BackupStripper — export step 2.5: physically deletes specified table rows from the
// backup.sqlite copy so the archive never carries rows that shouldn't cross machines.
//
// Two strip sources (combined by ExportOrchestrator, preset-aware):
// - ALWAYS_STRIP physical tables (`app_state` / `job`) — full + lite (global runtime
//   state / job queue, not user data). FTS5 virtual tables (message_fts /
//   agent_session_message_fts) are NOT stripped here: external-content FTS index is
//   bound to the content table, so `DELETE FROM` does not clear the shadow index while
//   the content rows survive, and dropping the virtual table breaks migrate-forward.
//   Restore runs the FTS5 'rebuild' command to repopulate a fresh index on the target.
// - lite excluded domains (KNOWLEDGE / PAINTINGS / FILE_STORAGE / TRANSLATE_HISTORY
//   owned tables) — lite only.
//
// WHY ORCHESTRATOR-LEVEL (not a contributor `beforeArchive` hook): global runtime
// tables are owned by no contributor, and excluded-domain contributors are never
// invoked in the lite `for (d of domains)` loop. Stripping belongs to the orchestrator,
// which derives the preset-aware table set and hands it here.
//
// FK STRATEGY: relies on schema-level `ON DELETE CASCADE` (every cross-domain FK into
// file_entry / knowledge_base is cascade, verified). The copy's per-connection
// `foreign_keys` pragma defaults OFF (online backup API copies pages, not pragma
// state), so the stripper opens a writable connection and explicitly sets
// `PRAGMA foreign_keys = ON` BEFORE any DELETE — otherwise CASCADE never fires and
// junction referrers (chat_message_file_ref / painting_file_ref / assistant_knowledge_base)
// are left dangling. VACUUM after strip purges freelist pages (no stripped-data
// recovery via raw page).

import { DB_TABLES, type DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import Database from 'better-sqlite3'

/** Trusted-table whitelist (codegen-derived) — every strip target MUST be in it. */
const DB_TABLES_SET: ReadonlySet<DbTableName> = new Set(DB_TABLES)

/** One table after stripping: which table, how many rows were deleted. */
export interface StrippedTable {
  readonly table: DbTableName
  readonly deletedRows: number
}

/**
 * Port: strip the given table rows from a backup.sqlite copy. The orchestrator
 * computes the preset-aware table set (ALWAYS_STRIP physical for full+lite, plus
 * lite-excluded owned tables for lite) and hands it here. Injected for testability.
 */
export interface BackupStripper {
  strip(backupDbPath: string, tables: readonly DbTableName[]): Promise<readonly StrippedTable[]>
}

/**
 * Strips by opening a writable better-sqlite3 connection on the copy, enabling
 * `PRAGMA foreign_keys = ON`, and DELETE-ing every table inside a single transaction.
 * CASCADE handles junction referrers automatically. VACUUM after strip purges freelist.
 *
 * Each table MUST be in DB_TABLES_SET (whitelist, injection-safe). FTS5 virtual tables
 * (message_fts / agent_session_message_fts) are NOT stripped here — external-content
 * FTS index binds to the content table, so `DELETE FROM` does not clear the shadow
 * index while content rows survive; restore runs the 'rebuild' command instead (see
 * export-orchestrator.md "ALWAYS_STRIP_TABLES global strip").
 */
export class SqliteBackupStripper implements BackupStripper {
  async strip(backupDbPath: string, tables: readonly DbTableName[]): Promise<readonly StrippedTable[]> {
    if (tables.length === 0) return []
    // Whitelist — every strip target MUST be a codegen-known physical table. Typos
    // or attacker-controlled values fail loud (DELETE FROM on an unknown identifier
    // would no-op or risk injection).
    for (const t of tables) {
      if (!DB_TABLES_SET.has(t)) {
        throw new Error(`BackupStripper: table '${t}' is not in DB_TABLES (typo / corrupt / FTS5 virtual)`)
      }
    }

    // Open a writable connection DISTINCT from the orchestrator's readonly snapshot.
    // The snapshot handle is opened AFTER strip completes (step 2.5 runs between
    // copyTo and the readonly open), so the two connections never overlap.
    const db = new Database(backupDbPath)
    try {
      // MUST enable before any DELETE: the copy's foreign_keys pragma defaults OFF
      // (online backup API copies pages, not source-connection pragma state).
      db.pragma('foreign_keys = ON')

      const run = db.transaction((): StrippedTable[] => {
        const out: StrippedTable[] = []
        for (const table of tables) {
          // Identifier is double-quoted (SQLite standard) AND whitelisted above, so
          // the raw interpolation is safe — no user-controlled value reaches here.
          db.exec(`DELETE FROM "${table}"`)
          // SQLite changes() — row count of the most recent DELETE on this connection.
          const deletedRows = (db.prepare('SELECT changes() AS c').get() as { c: number }).c
          out.push({ table, deletedRows })
        }
        return out
      })
      const stripped = run()
      // VACUUM rebuilds the file, physically purging freelist pages that would
      // otherwise retain the stripped rows' payload bytes. Without this, the archive's
      // backup.sqlite could leak stripped data (translate text / painting prompts /
      // knowledge metadata / file paths / app_state) via raw page recovery. Runs
      // OUTSIDE the transaction (SQLite disallows VACUUM inside one), same connection.
      db.exec('VACUUM')
      return stripped
    } finally {
      db.close()
    }
  }
}

/** Test double — returns a canned result. No IO. */
export class StubStripper implements BackupStripper {
  constructor(private readonly result: readonly StrippedTable[] = []) {}
  async strip(): Promise<readonly StrippedTable[]> {
    return this.result
  }
}
