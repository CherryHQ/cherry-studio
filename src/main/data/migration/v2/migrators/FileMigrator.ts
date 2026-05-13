/** Migrates legacy v1 Dexie `files` table into the v2 `file_entry` SQLite table. */

import fs from 'node:fs'
import path from 'node:path'

import { fileEntryTable } from '@data/db/schemas/file'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { inArray, sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('FileMigrator')

const BATCH_SIZE = 500
const VALIDATE_SAMPLE_LIMIT = 10

/**
 * Strip leading dot from extension, return null for empty/extensionless.
 * Legacy v1 ext field looks like '.pdf' or '.txt' or '' for extensionless.
 */
function normalizeExt(ext: string | undefined | null): string | null {
  if (!ext || ext.trim() === '') return null
  const stripped = ext.startsWith('.') ? ext.slice(1) : ext
  return stripped.length > 0 ? stripped : null
}

/**
 * Parse an ISO date string to ms epoch.
 *
 * - Missing / empty input → `Date.now()` silently (v1 rows without `created_at`
 *   are valid, just timestamp-less).
 * - Non-empty but unparseable input → `Date.now()` plus an `onInvalid` callback
 *   so the migrator can record a warning. This keeps `parseTimestamp` pure and
 *   pushes the warning channel out to the caller (which knows the row id).
 *
 * Fallback to `Date.now()` (not `0`) keeps migrated rows sortable next to v2
 * rows; the warning is the diagnostic trail for users whose v1 data carried
 * corrupted dates.
 */
function parseTimestamp(dateStr: string | undefined | null, onInvalid?: (raw: string) => void): number {
  if (!dateStr) return Date.now()
  const ms = Date.parse(dateStr)
  if (Number.isNaN(ms)) {
    onInvalid?.(dateStr)
    return Date.now()
  }
  return ms
}

interface PreparedFileEntry {
  id: string
  origin: 'internal' | 'external'
  name: string
  ext: string | null
  size: number | null
  externalPath: string | null
  trashedAt: number | null
  createdAt: number
  updatedAt: number
}

/**
 * Determine origin and derive v2 fields from a v1 FileMetadata row.
 * Returns null if the row is malformed (missing required fields).
 *
 * The v1 id is preserved verbatim into v2 (per migration-plan §2.9): cross-table
 * references in message_blocks / paintings / knowledge_items / file_ref need no
 * translation, and `FileEntryIdSchema = z.uuid()` already accepts the v4 ids
 * that v1 emits.
 */
function toFileEntry(
  row: FileMetadata,
  userData: string,
  onWarning: (message: string) => void
): PreparedFileEntry | null {
  if (!row.id || typeof row.id !== 'string' || row.id.trim() === '') return null
  if (!row.path || typeof row.path !== 'string' || row.path.trim() === '') return null
  if (!row.name || typeof row.name !== 'string' || row.name.trim() === '') return null

  const ext = normalizeExt(row.ext)
  const createdAt = parseTimestamp(row.created_at, (raw) => {
    onWarning(`Invalid created_at for file id=${row.id}; falling back to migration time. raw=${JSON.stringify(raw)}`)
  })

  // Origin discrimination: internal files live under userData/Data/Files/
  const internalPrefix = path.join(userData, 'Data', 'Files')
  const isInternal = row.path.startsWith(internalPrefix)

  if (isInternal) {
    return {
      id: row.id,
      origin: 'internal',
      name: row.origin_name
        ? path.basename(row.origin_name, row.origin_name.includes('.') ? path.extname(row.origin_name) : '')
        : row.name,
      ext,
      size: typeof row.size === 'number' && row.size >= 0 ? row.size : 0,
      externalPath: null,
      trashedAt: null,
      createdAt,
      updatedAt: createdAt
    }
  }

  // External file
  return {
    id: row.id,
    origin: 'external',
    name: path.basename(row.path, path.extname(row.path)) || row.name,
    ext,
    size: null,
    externalPath: row.path,
    trashedAt: null,
    createdAt,
    updatedAt: createdAt
  }
}

export class FileMigrator extends BaseMigrator {
  readonly id = 'file'
  readonly name = 'Files'
  readonly description = 'Migrate file entries from Dexie to SQLite file_entry table'
  readonly order = 2.7

  private sourceCount = 0
  private skippedCount = 0
  private preparedEntries: PreparedFileEntry[] = []
  private warnings: string[] = []

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.preparedEntries = []
    this.warnings = []
  }

  private recordWarning(message: string): void {
    logger.warn(message)
    this.warnings.push(message)
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      if (!(await ctx.sources.dexieExport.tableExists('files'))) {
        const msg = 'files Dexie table not found - no file data to migrate'
        logger.warn(msg)
        return { success: true, itemCount: 0, warnings: [msg] }
      }

      const seenIds = new Set<string>()
      const reader = ctx.sources.dexieExport.createStreamReader('files')

      await reader.readInBatches<FileMetadata>(BATCH_SIZE, async (rows) => {
        for (const row of rows) {
          this.sourceCount += 1

          const entry = toFileEntry(row, ctx.paths.userData, (msg) => this.recordWarning(msg))
          if (!entry) {
            this.skippedCount += 1
            const label = row?.id ?? '(unknown)'
            this.recordWarning(`Skipped malformed file row (id=${label}): missing required fields`)
            continue
          }

          if (seenIds.has(entry.id)) {
            this.skippedCount += 1
            this.recordWarning(`Skipped duplicate file entry id=${entry.id}`)
            continue
          }

          seenIds.add(entry.id)
          this.preparedEntries.push(entry)
        }
      })

      logger.info('FileMigrator.prepare completed', {
        sourceCount: this.sourceCount,
        preparedCount: this.preparedEntries.length,
        skippedCount: this.skippedCount
      })

      return {
        success: true,
        itemCount: this.sourceCount,
        warnings: this.warnings.length > 0 ? this.warnings : undefined
      }
    } catch (error) {
      logger.error('FileMigrator.prepare failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedEntries.length === 0) {
      logger.info('FileMigrator.execute: no entries to migrate')
      return { success: true, processedCount: 0 }
    }

    let processed = 0

    try {
      // Idempotency belt-and-braces: MigrationEngine.verifyAndClearNewTables
      // clears file_entry before each run, but if a partial migration somehow
      // left rows behind, skip them rather than crash on UNIQUE constraint.
      const candidateIds = this.preparedEntries.map((e) => e.id)
      const existingIds = new Set<string>()
      for (let i = 0; i < candidateIds.length; i += BATCH_SIZE) {
        const chunk = candidateIds.slice(i, i + BATCH_SIZE)
        const rows = await ctx.db
          .select({ id: fileEntryTable.id })
          .from(fileEntryTable)
          .where(inArray(fileEntryTable.id, chunk))
          .all()
        for (const row of rows) existingIds.add(row.id)
      }

      const entriesToInsert: PreparedFileEntry[] = []
      for (const entry of this.preparedEntries) {
        if (existingIds.has(entry.id)) {
          processed += 1
        } else {
          entriesToInsert.push(entry)
        }
      }

      for (let i = 0; i < entriesToInsert.length; i += BATCH_SIZE) {
        const batch = entriesToInsert.slice(i, i + BATCH_SIZE)

        await ctx.db.transaction(async (tx) => {
          await tx.insert(fileEntryTable).values(batch)
        })

        processed += batch.length

        const total = this.preparedEntries.length
        const progress = Math.round((processed / total) * 100)
        this.reportProgress(progress, `Migrated ${processed}/${total} file entries`, {
          key: 'migration.progress.migrated_files',
          params: { processed, total }
        })
      }

      logger.info('FileMigrator.execute completed', { processed, total: this.preparedEntries.length })
      return { success: true, processedCount: processed }
    } catch (error) {
      logger.error('FileMigrator.execute failed', error as Error)
      return {
        success: false,
        processedCount: processed,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const errors: ValidationError[] = []

    try {
      const result = await ctx.db.select({ count: sql<number>`count(*)` }).from(fileEntryTable).get()
      const targetCount = result?.count ?? 0
      const expectedCount = this.preparedEntries.length

      if (targetCount < expectedCount) {
        errors.push({
          key: 'file_entry_count_mismatch',
          expected: expectedCount,
          actual: targetCount,
          message: `Expected at least ${expectedCount} file entries, got ${targetCount}`
        })
      }

      // Sample physical files for internal entries
      const internalEntries = this.preparedEntries
        .filter((e) => e.origin === 'internal')
        .slice(0, VALIDATE_SAMPLE_LIMIT)

      for (const entry of internalEntries) {
        const physicalPath = path.join(
          ctx.paths.userData,
          'Data',
          'Files',
          entry.ext ? `${entry.id}.${entry.ext}` : entry.id
        )
        if (!fs.existsSync(physicalPath)) {
          errors.push({
            key: 'file_entry_missing_physical_file',
            message: `Physical file missing for entry id=${entry.id}: ${physicalPath}`
          })
        }
      }

      logger.info('FileMigrator.validate completed', {
        sourceCount: this.sourceCount,
        targetCount,
        skippedCount: this.skippedCount,
        errors: errors.length
      })

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.sourceCount,
          targetCount,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('FileMigrator.validate failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.sourceCount,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
