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

import { type MigrationExportFileWriteMode, MigrationIpcChannels } from '@shared/data/migration/v2/types'
import { Dexie, type IndexableType } from 'dexie'

/** Legacy v1 IndexedDB database name. */
const DEXIE_DB_NAME = 'CherryStudio'
const DEXIE_EXPORT_PAGE_SIZE = 100
const DEXIE_EXPORT_CHUNK_CHAR_LIMIT = 1024 * 1024

// Required tables that must exist
const REQUIRED_TABLES = [
  'topics', // Contains messages embedded within each topic
  'files', // File metadata
  'knowledge_notes', // Individual knowledge note items
  'message_blocks' // Message block data
]

// Optional tables that may not exist in older versions
const OPTIONAL_TABLES = ['settings', 'translate_history', 'quick_phrases', 'translate_languages']

export interface ExportProgress {
  table: string
  progress: number
  total: number
}

export class DexieExporter {
  private exportPath: string

  constructor(exportPath: string) {
    this.exportPath = exportPath
  }

  private async writeExportChunk(
    tableName: string,
    jsonChunk: string,
    writeMode: MigrationExportFileWriteMode
  ): Promise<void> {
    await window.electron.ipcRenderer.invoke(
      MigrationIpcChannels.WriteExportFile,
      this.exportPath,
      tableName,
      jsonChunk,
      writeMode
    )
  }

  private createRecordExportError(tableName: string, primaryKey: IndexableType, cause: unknown): Error {
    const causeMessage = cause instanceof Error ? cause.message : String(cause)
    return new Error(
      `Failed to export Dexie table "${tableName}" at primary key "${String(primaryKey)}": ${causeMessage}`,
      { cause }
    )
  }

  private async exportTable(db: Dexie, tableName: string): Promise<void> {
    const table = db.table<Record<string, unknown>, IndexableType>(tableName)
    let lastPrimaryKey: IndexableType | undefined
    let pendingChunk = ''
    let hasRecords = false

    await this.writeExportChunk(tableName, '[', 'overwrite')

    while (true) {
      const collection = lastPrimaryKey === undefined ? table.orderBy(':id') : table.where(':id').above(lastPrimaryKey)
      const primaryKeys = await collection.limit(DEXIE_EXPORT_PAGE_SIZE).primaryKeys()

      if (primaryKeys.length === 0) {
        break
      }

      const records = await table.bulkGet(primaryKeys)

      for (let index = 0; index < primaryKeys.length; index++) {
        const primaryKey = primaryKeys[index]
        const record = records[index]

        if (record === undefined) {
          throw this.createRecordExportError(tableName, primaryKey, new Error('Record missing from IndexedDB page'))
        }

        let serializedRecord: string | undefined
        try {
          serializedRecord = JSON.stringify(record)
        } catch (error) {
          throw this.createRecordExportError(tableName, primaryKey, error)
        }

        if (serializedRecord === undefined) {
          throw this.createRecordExportError(tableName, primaryKey, new Error('Record is not JSON serializable'))
        }

        const entry = `${hasRecords ? ',' : ''}${serializedRecord}`
        if (pendingChunk && pendingChunk.length + entry.length > DEXIE_EXPORT_CHUNK_CHAR_LIMIT) {
          await this.writeExportChunk(tableName, pendingChunk, 'append')
          pendingChunk = ''
        }

        if (entry.length > DEXIE_EXPORT_CHUNK_CHAR_LIMIT) {
          await this.writeExportChunk(tableName, entry, 'append')
        } else {
          pendingChunk += entry
        }
        hasRecords = true
      }

      lastPrimaryKey = primaryKeys[primaryKeys.length - 1]
    }

    if (pendingChunk) {
      await this.writeExportChunk(tableName, pendingChunk, 'append')
    }
    await this.writeExportChunk(tableName, ']', 'append')
  }

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
   * @returns Export path
   */
  async exportAll(onProgress?: (progress: ExportProgress) => void): Promise<string> {
    const db = await this.openLegacyDb()
    if (!db) {
      // No Dexie database at all — fresh install, nothing to export
      return this.exportPath
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

        await this.exportTable(db, tableName)

        onProgress?.({
          table: tableName,
          progress: i + 1,
          total: tablesToExport.length
        })
      }

      return this.exportPath
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
