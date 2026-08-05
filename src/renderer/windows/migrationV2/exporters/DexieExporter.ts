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
import { clampSurrogateBoundary } from '@shared/utils/text'
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

class JsonExportWriter {
  private pending = ''
  private writeMode: MigrationExportFileWriteMode = 'overwrite'
  private readonly activeObjects = new WeakSet<object>()

  constructor(
    private readonly exportPath: string,
    private readonly tableName: string
  ) {}

  private async flush(): Promise<void> {
    if (!this.pending) return
    await window.electron.ipcRenderer.invoke(
      MigrationIpcChannels.WriteExportFile,
      this.exportPath,
      this.tableName,
      this.pending,
      this.writeMode
    )
    this.pending = ''
    this.writeMode = 'append'
  }

  async append(text: string): Promise<void> {
    let offset = 0
    while (offset < text.length) {
      const available = DEXIE_EXPORT_CHUNK_CHAR_LIMIT - this.pending.length
      const requestedEnd = Math.min(offset + available, text.length)
      const end = clampSurrogateBoundary(text, requestedEnd)
      if (end === offset) {
        await this.flush()
        continue
      }
      this.pending += text.slice(offset, end)
      offset = end
      if (this.pending.length >= DEXIE_EXPORT_CHUNK_CHAR_LIMIT) await this.flush()
    }
  }

  private prepareValue(value: unknown): unknown {
    if (value && typeof value === 'object') {
      const toJSON = (value as { toJSON?: unknown }).toJSON
      if (typeof toJSON === 'function') return toJSON.call(value)
      if (value instanceof Number || value instanceof String || value instanceof Boolean) return value.valueOf()
    }
    return value
  }

  private isOmitted(value: unknown): boolean {
    return value === undefined || typeof value === 'function' || typeof value === 'symbol'
  }

  private async appendString(value: string): Promise<void> {
    await this.append('"')
    let offset = 0
    while (offset < value.length) {
      const requestedEnd = Math.min(offset + DEXIE_EXPORT_CHUNK_CHAR_LIMIT / 4, value.length)
      const end = clampSurrogateBoundary(value, requestedEnd)
      const encoded = JSON.stringify(value.slice(offset, end))
      await this.append(encoded.slice(1, -1))
      offset = end
    }
    await this.append('"')
  }

  private async appendPreparedValue(value: unknown, arrayElement: boolean): Promise<boolean> {
    if (this.isOmitted(value)) {
      if (arrayElement) await this.append('null')
      return arrayElement
    }
    if (value === null) {
      await this.append('null')
      return true
    }

    switch (typeof value) {
      case 'string':
        await this.appendString(value)
        return true
      case 'number':
        await this.append(Number.isFinite(value) ? String(value === 0 ? 0 : value) : 'null')
        return true
      case 'boolean':
        await this.append(value ? 'true' : 'false')
        return true
      case 'bigint':
        throw new TypeError('Do not know how to serialize a BigInt')
      case 'object': {
        const object = value
        if (this.activeObjects.has(object)) throw new TypeError('Converting circular structure to JSON')
        this.activeObjects.add(object)
        try {
          if (Array.isArray(value)) {
            await this.append('[')
            for (let index = 0; index < value.length; index++) {
              if (index > 0) await this.append(',')
              await this.appendValue(value[index], true)
            }
            await this.append(']')
            return true
          }

          await this.append('{')
          let emitted = 0
          for (const key of Object.keys(value as Record<string, unknown>)) {
            const propertyValue = this.prepareValue((value as Record<string, unknown>)[key])
            if (this.isOmitted(propertyValue)) continue
            if (emitted > 0) await this.append(',')
            await this.appendString(key)
            await this.append(':')
            await this.appendPreparedValue(propertyValue, false)
            emitted++
          }
          await this.append('}')
          return true
        } finally {
          this.activeObjects.delete(object)
        }
      }
      default:
        return false
    }
  }

  async appendValue(value: unknown, arrayElement = false): Promise<boolean> {
    return this.appendPreparedValue(this.prepareValue(value), arrayElement)
  }

  async close(): Promise<void> {
    await this.flush()
  }
}

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
    let hasRecords = false
    const writer = new JsonExportWriter(this.exportPath, tableName)

    await writer.append('[')

    while (true) {
      const collection = lastPrimaryKey === undefined ? table.orderBy(':id') : table.where(':id').above(lastPrimaryKey)
      const primaryKeys = await collection.limit(DEXIE_EXPORT_PAGE_SIZE).primaryKeys()

      if (primaryKeys.length === 0) {
        break
      }

      for (let index = 0; index < primaryKeys.length; index++) {
        const primaryKey = primaryKeys[index]
        // Keep the renderer's live record set bounded to one item. A page of
        // topics can contain enough embedded messages to exhaust its heap when
        // all records are materialized together.
        const record = await table.get(primaryKey)

        if (record === undefined) {
          throw this.createRecordExportError(tableName, primaryKey, new Error('Record missing from IndexedDB page'))
        }

        try {
          if (hasRecords) await writer.append(',')
          if (!(await writer.appendValue(record))) {
            throw new Error('Record is not JSON serializable')
          }
        } catch (error) {
          throw this.createRecordExportError(tableName, primaryKey, error)
        }
        hasRecords = true
      }

      lastPrimaryKey = primaryKeys[primaryKeys.length - 1]
    }

    await writer.append(']')
    await writer.close()
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
