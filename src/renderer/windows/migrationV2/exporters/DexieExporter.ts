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

import { loggerService } from '@renderer/services/LoggerService'
import {
  type DexieRecoveryReport,
  type MigrationExportFileWriteMode,
  MigrationIpcChannels
} from '@shared/data/migration/v2/types'
import { clampSurrogateBoundary } from '@shared/utils/text'
import { Dexie, type IndexableType, type Table } from 'dexie'

/** Legacy v1 IndexedDB database name. */
const DEXIE_DB_NAME = 'CherryStudio'
const DEXIE_EXPORT_PAGE_SIZE = 100
const DEXIE_EXPORT_CHUNK_CHAR_LIMIT = 1024 * 1024
const RECOVERY_SAMPLE_KEY_LIMIT = 10
const RECOVERY_ERROR_SAMPLE_LIMIT = 10
const RECOVERY_WRAPPED_ERROR_LIMIT = 5
// Chromium emits this exact two-sentence message when an IndexedDB backing file is gone. Match it as a
// substring because Dexie may prefix the message while wrapping the DOMException in `cause` or `inner`.
// If Chromium changes the wording, matching safely stops and the migration remains fatal.
const IRRECOVERABLE_MISSING_FILE_MESSAGE =
  'Data lost due to missing file. Affected record should be considered irrecoverable'

const logger = loggerService.withContext('DexieExporter')

// Required tables that must exist
const REQUIRED_TABLES = [
  'topics', // Contains messages embedded within each topic
  'files', // File metadata
  'knowledge_notes', // Individual knowledge note items
  'message_blocks' // Message block data
]

// Optional tables that may not exist in older versions
const OPTIONAL_TABLES = ['settings', 'translate_history', 'quick_phrases', 'translate_languages']
const SUPPORTED_TABLES = [...REQUIRED_TABLES, ...OPTIONAL_TABLES]

export interface ExportProgress {
  table: string
  progress: number
  total: number
}

export interface DexieExportResult {
  exportPath: string
  recoveryReports: DexieRecoveryReport[]
}

interface PageRecord {
  primaryKey: IndexableType
  record: Record<string, unknown> | undefined
}

interface PageReadResult {
  records: PageRecord[]
  skippedPrimaryKeys: IndexableType[]
}

interface RecoveryLogBudget {
  remaining: number
}

interface RecoveryErrorDetails {
  errorName: string
  errorMessage: string
  errorStack?: string
}

type RecoveryOperation = 'bulkGet' | 'exists' | 'get' | 'open' | 'primaryKeys'

function isIrrecoverableMissingFileError(error: unknown): boolean {
  const visited = new Set<object>()
  const pending: unknown[] = [error]

  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current !== 'object' || current === null || visited.has(current)) continue
    visited.add(current)
    const candidate = current as { cause?: unknown; inner?: unknown; message?: unknown }
    if (typeof candidate.message === 'string' && candidate.message.includes(IRRECOVERABLE_MISSING_FILE_MESSAGE)) {
      return true
    }
    pending.push(candidate.cause, candidate.inner)
  }

  return false
}

function getRecoveryErrorDetails(error: unknown): RecoveryErrorDetails {
  if (typeof error !== 'object' || error === null) {
    return { errorName: 'UnknownError', errorMessage: String(error) }
  }

  const candidate = error as { message?: unknown; name?: unknown; stack?: unknown }
  return {
    errorName: typeof candidate.name === 'string' ? candidate.name : 'UnknownError',
    errorMessage: typeof candidate.message === 'string' ? candidate.message : String(error),
    ...(typeof candidate.stack === 'string' ? { errorStack: candidate.stack } : {})
  }
}

function getWrappedRecoveryErrors(error: unknown): RecoveryErrorDetails[] {
  if (typeof error !== 'object' || error === null) return []

  const visited = new Set<object>([error])
  const root = error as { cause?: unknown; inner?: unknown }
  const pending = [root.cause, root.inner]
  const wrappedErrors: RecoveryErrorDetails[] = []

  while (pending.length > 0 && wrappedErrors.length < RECOVERY_WRAPPED_ERROR_LIMIT) {
    const current = pending.pop()
    if (typeof current !== 'object' || current === null || visited.has(current)) continue
    visited.add(current)
    wrappedErrors.push(getRecoveryErrorDetails(current))
    const candidate = current as { cause?: unknown; inner?: unknown }
    pending.push(candidate.cause, candidate.inner)
  }

  return wrappedErrors
}

export class DexieExporter {
  private exportPath: string

  constructor(exportPath: string) {
    this.exportPath = exportPath
  }

  private async writeExportText(
    tableName: string,
    jsonText: string,
    writeMode: MigrationExportFileWriteMode
  ): Promise<void> {
    let offset = 0
    let nextWriteMode = writeMode

    while (offset < jsonText.length) {
      const requestedEnd = Math.min(offset + DEXIE_EXPORT_CHUNK_CHAR_LIMIT, jsonText.length)
      const end = clampSurrogateBoundary(jsonText, requestedEnd)
      await window.electron.ipcRenderer.invoke(
        MigrationIpcChannels.WriteExportFile,
        this.exportPath,
        tableName,
        jsonText.slice(offset, end),
        nextWriteMode
      )
      offset = end
      nextWriteMode = 'append'
    }
  }

  private async writeEmptySupportedTables(): Promise<void> {
    for (const tableName of SUPPORTED_TABLES) {
      await this.writeExportText(tableName, '[]', 'overwrite')
    }
  }

  private createResult(recoveryReports: DexieRecoveryReport[]): DexieExportResult {
    if (recoveryReports.length > 0) {
      logger.warn('Recovered migration export from irrecoverable IndexedDB data loss', { recoveryReports })
    }
    return { exportPath: this.exportPath, recoveryReports }
  }

  private logRecoveryError(
    budget: RecoveryLogBudget | undefined,
    context: {
      scope: DexieRecoveryReport['scope']
      operation: RecoveryOperation
      tableName?: string
      primaryKey?: string
    },
    error: unknown
  ): void {
    if (!budget || budget.remaining <= 0) return
    budget.remaining -= 1
    logger.warn('Recovering from irrecoverable IndexedDB read error', {
      ...context,
      ...getRecoveryErrorDetails(error),
      wrappedErrors: getWrappedRecoveryErrors(error)
    })
  }

  private createRecordExportError(tableName: string, primaryKey: IndexableType, cause: unknown): Error {
    const causeMessage = cause instanceof Error ? cause.message : String(cause)
    return new Error(
      `Failed to export Dexie table "${tableName}" at primary key "${String(primaryKey)}": ${causeMessage}`,
      { cause }
    )
  }

  private async readPage(
    table: Table<Record<string, unknown>, IndexableType>,
    tableName: string,
    primaryKeys: IndexableType[],
    recoveryLogBudget: RecoveryLogBudget
  ): Promise<PageReadResult> {
    try {
      const records = await table.bulkGet(primaryKeys)
      return {
        records: primaryKeys.map((primaryKey, index) => ({ primaryKey, record: records[index] })),
        skippedPrimaryKeys: []
      }
    } catch (error) {
      if (!isIrrecoverableMissingFileError(error)) throw error
      this.logRecoveryError(recoveryLogBudget, { scope: 'records', operation: 'bulkGet', tableName }, error)
    }

    const records: PageRecord[] = []
    const skippedPrimaryKeys: IndexableType[] = []
    for (const primaryKey of primaryKeys) {
      try {
        const record = await table.get(primaryKey)
        if (record === undefined) {
          skippedPrimaryKeys.push(primaryKey)
        } else {
          records.push({ primaryKey, record })
        }
      } catch (error) {
        if (!isIrrecoverableMissingFileError(error)) {
          throw this.createRecordExportError(tableName, primaryKey, error)
        }
        skippedPrimaryKeys.push(primaryKey)
        this.logRecoveryError(
          recoveryLogBudget,
          { scope: 'records', operation: 'get', tableName, primaryKey: String(primaryKey) },
          error
        )
      }
    }

    return { records, skippedPrimaryKeys }
  }

  private async exportTable(db: Dexie, tableName: string): Promise<DexieRecoveryReport | undefined> {
    const table = db.table<Record<string, unknown>, IndexableType>(tableName)
    let lastPrimaryKey: IndexableType | undefined
    let pendingChunk = ''
    let hasRecords = false
    let skippedRecords = 0
    const samplePrimaryKeys: string[] = []
    const recoveryLogBudget = { remaining: RECOVERY_ERROR_SAMPLE_LIMIT }

    await this.writeExportText(tableName, '[', 'overwrite')

    while (true) {
      const collection = lastPrimaryKey === undefined ? table.orderBy(':id') : table.where(':id').above(lastPrimaryKey)
      let primaryKeys: IndexableType[]
      try {
        primaryKeys = await collection.limit(DEXIE_EXPORT_PAGE_SIZE).primaryKeys()
      } catch (error) {
        if (!isIrrecoverableMissingFileError(error)) throw error
        this.logRecoveryError(recoveryLogBudget, { scope: 'table', operation: 'primaryKeys', tableName }, error)
        // Key enumeration can no longer prove which pages remain complete, so discard every partial page.
        await this.writeExportText(tableName, '[]', 'overwrite')
        return { scope: 'table', table: tableName }
      }

      if (primaryKeys.length === 0) {
        break
      }

      const page = await this.readPage(table, tableName, primaryKeys, recoveryLogBudget)
      skippedRecords += page.skippedPrimaryKeys.length
      for (const primaryKey of page.skippedPrimaryKeys) {
        if (samplePrimaryKeys.length < RECOVERY_SAMPLE_KEY_LIMIT) {
          samplePrimaryKeys.push(String(primaryKey))
        }
      }

      for (const { primaryKey, record } of page.records) {
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
          await this.writeExportText(tableName, pendingChunk, 'append')
          pendingChunk = ''
        }

        if (entry.length > DEXIE_EXPORT_CHUNK_CHAR_LIMIT) {
          await this.writeExportText(tableName, entry, 'append')
        } else {
          pendingChunk += entry
        }
        hasRecords = true
      }

      lastPrimaryKey = primaryKeys[primaryKeys.length - 1]
    }

    if (pendingChunk) {
      await this.writeExportText(tableName, pendingChunk, 'append')
    }
    await this.writeExportText(tableName, ']', 'append')

    if (skippedRecords > 0) {
      return { scope: 'records', table: tableName, skippedRecords, samplePrimaryKeys }
    }
    return undefined
  }

  /**
   * Open the legacy v1 database in dynamic mode, or return null when no such
   * database exists (fresh install — nothing to migrate). The caller owns
   * closing the returned instance.
   */
  private async openLegacyDb(recoveryLogBudget?: RecoveryLogBudget): Promise<Dexie | null> {
    let exists: boolean
    try {
      exists = await Dexie.exists(DEXIE_DB_NAME)
    } catch (error) {
      if (isIrrecoverableMissingFileError(error)) {
        this.logRecoveryError(recoveryLogBudget, { scope: 'database', operation: 'exists' }, error)
      }
      throw error
    }
    if (!exists) {
      return null
    }
    const db = new Dexie(DEXIE_DB_NAME)
    try {
      await db.open()
      return db
    } catch (error) {
      db.close()
      if (isIrrecoverableMissingFileError(error)) {
        this.logRecoveryError(recoveryLogBudget, { scope: 'database', operation: 'open' }, error)
      }
      throw error
    }
  }

  /**
   * Export all supported Dexie tables to JSON files.
   * @param onProgress - Progress callback
   * @returns Export directory and any reports describing irrecoverable data skipped during export
   */
  async exportAll(onProgress?: (progress: ExportProgress) => void): Promise<DexieExportResult> {
    let db: Dexie | null
    const recoveryLogBudget = { remaining: RECOVERY_ERROR_SAMPLE_LIMIT }
    try {
      db = await this.openLegacyDb(recoveryLogBudget)
    } catch (error) {
      if (!isIrrecoverableMissingFileError(error)) throw error
      await this.writeEmptySupportedTables()
      return this.createResult([{ scope: 'database' }])
    }
    if (!db) {
      // No Dexie database at all — fresh install, nothing to export
      return this.createResult([])
    }

    try {
      const recoveryReports: DexieRecoveryReport[] = []
      const existingTables = db.tables.map((t) => t.name)

      // Determine which tables to export (skip missing ones gracefully)
      const tablesToExport = SUPPORTED_TABLES.filter((t) => existingTables.includes(t))

      // Export each table
      for (let i = 0; i < tablesToExport.length; i++) {
        const tableName = tablesToExport[i]

        onProgress?.({
          table: tableName,
          progress: 0,
          total: tablesToExport.length
        })

        const issue = await this.exportTable(db, tableName)
        if (issue) recoveryReports.push(issue)

        onProgress?.({
          table: tableName,
          progress: i + 1,
          total: tablesToExport.length
        })
      }

      return this.createResult(recoveryReports)
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
