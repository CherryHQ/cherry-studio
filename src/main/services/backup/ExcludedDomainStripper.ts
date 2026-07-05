// ExcludedDomainStripper — lite preset step 2.5: physically deletes excluded-domain
// table rows from the backup.sqlite copy so a lite archive never carries rows the
// manifest claims are absent (spec export-orchestrator.md "Excluded-domain row strip").
//
// WHY ORCHESTRATOR-LEVEL (not a contributor `beforeArchive` hook): excluded domains
// (KNOWLEDGE / PAINTINGS / FILE_STORAGE / TRANSLATE_HISTORY) are NOT in the lite
// `domains` set, so their contributors are never invoked in the `for (d of domains)`
// loop. Stripping therefore belongs to the orchestrator, which owns the registry
// and can derive each excluded domain's owned tables via `registry.getSchema(d).tables`.
//
// FK STRATEGY: relies on schema-level `ON DELETE CASCADE` (every cross-domain FK into
// file_entry / knowledge_base is cascade, verified). The backup copy's per-connection
// `foreign_keys` pragma defaults OFF — sqlite's online backup API (`SqliteBackupCopier`)
// copies pages, not the source connection's pragma state — so the stripper opens a
// writable connection and explicitly sets `PRAGMA foreign_keys = ON` BEFORE any DELETE.
// Without it, CASCADE never fires and junction referrers (chat_message_file_ref /
// painting_file_ref / assistant_knowledge_base) are left dangling. No per-referrer
// DELETE logic is needed because cascade handles the junction prune.

import Database from 'better-sqlite3'

import type { BackupDomain } from '@main/data/db/backup/domains'
import type { ReadonlyBackupRegistry } from '@main/data/db/backup/contributor-types'
import { DB_TABLES, type DbTableName } from '@main/data/db/backup/dbSchemaRefs'

/** Trusted-table whitelist (codegen-derived) — every strip target MUST be in it. */
const DB_TABLES_SET: ReadonlySet<DbTableName> = new Set(DB_TABLES)

/** One excluded-domain table after stripping: which table, how many rows were deleted. */
export interface StrippedTable {
  readonly table: DbTableName
  readonly deletedRows: number
}

/**
 * Port: strip excluded-domain table rows from a backup.sqlite copy. Injected into
 * ExportOrchestrator so the write path is testable in isolation (StubStripper).
 */
export interface BackupStripper {
  strip(backupDbPath: string, excludedDomains: readonly BackupDomain[]): Promise<readonly StrippedTable[]>
}

/**
 * Resolve the owned tables of the excluded domains, deduped. Each MUST be a real DB
 * table (whitelist check) — tables come from the finalized registry (codegen-backed),
 * so a stray value would indicate registry corruption, not user input.
 */
function resolveExcludedTables(
  registry: ReadonlyBackupRegistry,
  excludedDomains: readonly BackupDomain[]
): readonly DbTableName[] {
  const seen = new Set<DbTableName>()
  const tables: DbTableName[] = []
  for (const d of excludedDomains) {
    for (const t of registry.getSchema(d).tables) {
      if (!DB_TABLES_SET.has(t)) {
        // Unreachable with a finalized registry (finalize #2/#3 already assert every
        // owned table ∈ DB_TABLES and not multi-owned). Guard anyway: a DELETE FROM on
        // an unknown identifier would no-op (typo) or risk injection if the value were
        // ever attacker-controlled. Fail loud rather than silently skip.
        throw new Error(`ExcludedDomainStripper: table '${t}' (owned by ${d}) is not in DB_TABLES`)
      }
      if (!seen.has(t)) {
        seen.add(t)
        tables.push(t)
      }
    }
  }
  return tables
}

/**
 * Strips by opening a writable better-sqlite3 connection on the copy, enabling
 * `PRAGMA foreign_keys = ON`, and DELETE-ing every excluded table inside a single
 * transaction. CASCADE handles junction referrers (chat_message_file_ref /
 * painting_file_ref / assistant_knowledge_base) automatically — there is no
 * per-referrer logic here because every cross-domain FK into the excluded tables
 * is `onDelete: cascade`.
 */
export class SqliteExcludedDomainStripper implements BackupStripper {
  constructor(private readonly registry: ReadonlyBackupRegistry) {}

  async strip(backupDbPath: string, excludedDomains: readonly BackupDomain[]): Promise<readonly StrippedTable[]> {
    const tables = resolveExcludedTables(this.registry, excludedDomains)
    if (tables.length === 0) return []

    // Open a writable connection DISTINCT from the orchestrator's readonly snapshot.
    // The snapshot handle is opened AFTER strip completes (ExportOrchestrator step 2.5
    // runs between copyTo and the readonly open), so the two connections never overlap.
    const db = new Database(backupDbPath)
    try {
      // MUST enable before any DELETE: the copy's foreign_keys pragma defaults OFF
      // (online backup API copies pages, not source-connection pragma state). Without
      // this, CASCADE on the junction referrers never fires and they're left dangling.
      db.pragma('foreign_keys = ON')

      const run = db.transaction((): StrippedTable[] => {
        const out: StrippedTable[] = []
        for (const table of tables) {
          // Identifier is double-quoted (SQLite standard for arbitrary identifiers)
          // AND whitelisted above, so the raw interpolation is safe — no user-controlled
          // value reaches here (tables come from the codegen-backed registry).
          db.exec(`DELETE FROM "${table}"`)
          // SQLite changes() — row count of the most recent DELETE on this connection.
          // (Preferred over the `db.changes` property: the latter is not on the
          // better-sqlite3 type surface and trips tsgo.)
          const deletedRows = (db.prepare('SELECT changes() AS c').get() as { c: number }).c
          out.push({ table, deletedRows })
        }
        return out
      })
      const stripped = run()
      // VACUUM rebuilds the file, physically purging freelist pages that would
      // otherwise retain the stripped rows' payload bytes. Without this, a lite
      // archive's backup.sqlite could leak excluded-domain data (translate text,
      // painting prompts, knowledge metadata, file paths) via raw page recovery —
      // defeating lite's "excluded domains are absent" guarantee. Runs OUTSIDE the
      // transaction (SQLite disallows VACUUM inside one) but on the same connection.
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
