import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import { DB_FTS_VIRTUAL_TABLES } from '@main/data/db/backup/dbSchemaRefs'
import type Database from 'better-sqlite3'

/** An FTS5 external-content index does not match its source table. */
export class FtsIntegrityCheckError extends Error {
  constructor(ftsTable: string, detail: string) {
    super(`FTS integrity-check failed for '${ftsTable}': ${detail}`)
    this.name = 'FtsIntegrityCheckError'
  }
}

/** Rebuild and verify every schema-owned FTS5 external-content index in work.sqlite. */
export const FtsCentralHelper = {
  rebuild(work: Database.Database): void {
    for (const fts of Object.keys(DB_FTS_VIRTUAL_TABLES) as DbTableName[]) {
      // The FTS5 rebuild command makes the detached index match all imported content rows.
      work.prepare(`INSERT INTO ${fts} (${fts}) VALUES ('rebuild')`).run()
    }
  },

  integrityCheck(work: Database.Database): void {
    for (const fts of Object.keys(DB_FTS_VIRTUAL_TABLES) as DbTableName[]) {
      try {
        // `.run()` is required because FTS5 reports integrity errors by throwing, not returning rows.
        work.prepare(`INSERT INTO ${fts} (${fts}, rank) VALUES ('integrity-check', 1)`).run()
      } catch (error) {
        throw new FtsIntegrityCheckError(fts, error instanceof Error ? error.message : String(error))
      }
    }
  }
}
