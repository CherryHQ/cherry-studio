/**
 * Dexie database exporter for migration.
 *
 * Exports the legacy v1 `CherryStudio` IndexedDB tables to JSON files for the
 * Main process to read. The database is opened in Dexie "dynamic mode" (no
 * schema declared) so the migration window no longer depends on the deprecated
 * `@renderer/databases` schema module: `db.tables` is reflected from whatever
 * object stores exist on disk. The v2 migration gate (`versionPolicy.ts`) only
 * admits users coming from a final v1 release, whose on-disk schema is already
 * at its last version, so no Dexie upgrade hooks need to run before export.
 */

import {
  assertMigrationExportWriteSucceeded,
  type MigrationExportWriteResult
} from '@shared/data/migration/v2/diagnostics'
import { type MigrationDexieExportTable, MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { Dexie } from 'dexie'

/** Legacy v1 IndexedDB database name. */
const DEXIE_DB_NAME = 'CherryStudio'

// Required tables that must exist
const REQUIRED_TABLES: readonly MigrationDexieExportTable[] = [
  'topics', // Contains messages embedded within each topic
  'files', // File metadata
  'knowledge_notes', // Individual knowledge note items
  'message_blocks' // Message block data
]

// Optional tables that may not exist in older versions
const OPTIONAL_TABLES: readonly MigrationDexieExportTable[] = [
  'settings',
  'translate_history',
  'quick_phrases',
  'translate_languages'
]

export interface ExportProgress {
  table: string
  progress: number
  total: number
}

export class DexieExporter {
  /**
   * Open the legacy v1 database in dynamic mode, or return null when no such
   * database exists (fresh install — nothing to migrate). The caller owns
   * closing the returned instance.
   */
  private async openLegacyDb(): Promise<Dexie | null> {
    if (!(await Dexie.exists(DEXIE_DB_NAME))) {
      return null
    }
    const db = new Dexie(DEXIE_DB_NAME)
    await db.open()
    return db
  }

  /**
   * Export all Dexie tables to JSON files
   * @param onProgress - Progress callback
   */
  async exportAll(onProgress?: (progress: ExportProgress) => void): Promise<void> {
    const db = await this.openLegacyDb()
    if (!db) {
      // No Dexie database at all — fresh install, nothing to export
      return
    }

    try {
      const existingTables = db.tables.map((t) => t.name)

      // Determine which tables to export (skip missing ones gracefully)
      const tablesToExport = [...REQUIRED_TABLES, ...OPTIONAL_TABLES].filter((t) => existingTables.includes(t))

      // Export each table
      for (let i = 0; i < tablesToExport.length; i++) {
        const tableName = tablesToExport[i]

        onProgress?.({
          table: tableName,
          progress: 0,
          total: tablesToExport.length
        })

        const data = await db.table(tableName).toArray()

        // Send data to Main process for writing
        // Uses IPC invoke with migration channel
        const result = (await window.electron.ipcRenderer.invoke(MigrationIpcChannels.WriteExportFile, {
          target: 'dexie',
          tableName,
          jsonData: JSON.stringify(data)
        })) as MigrationExportWriteResult
        assertMigrationExportWriteSucceeded(result)

        onProgress?.({
          table: tableName,
          progress: i + 1,
          total: tablesToExport.length
        })
      }
    } finally {
      db.close()
    }
  }

  /**
   * Get table counts for validation
   */
  async getTableCounts(): Promise<Record<string, number>> {
    const db = await this.openLegacyDb()
    if (!db) {
      return {}
    }

    try {
      const counts: Record<string, number> = {}

      for (const table of db.tables) {
        counts[table.name] = await table.count()
      }

      return counts
    } finally {
      db.close()
    }
  }
}
