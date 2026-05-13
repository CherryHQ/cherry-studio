/** Migrates legacy v1 Dexie `files` table into the v2 `file_entry` SQLite table. */

import fs from 'node:fs'
import path from 'node:path'

import { fileEntryTable } from '@data/db/schemas/file'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { inArray, sql } from 'drizzle-orm'
import { v5 as uuidv5 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('FileMigrator')

/**
 * Fixed namespace UUID for deterministic v4 → v5 (used-as-v7) translation.
 * Never change this — it's the key that makes re-runs idempotent.
 */
const FILE_MIGRATION_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8' // UUID namespace for URLs

const BATCH_SIZE = 500
const VALIDATE_SAMPLE_LIMIT = 10

/**
 * Detect UUID version from a UUID string.
 * Returns the numeric version (4, 7, etc.) or null if not parseable.
 */
function getUuidVersion(id: string): number | null {
  // UUID format: xxxxxxxx-xxxx-Vxxx-xxxx-xxxxxxxxxxxx
  // Version nibble is at index 14 of the string (after removing dashes)
  const stripped = id.replace(/-/g, '')
  if (stripped.length !== 32) return null
  const versionChar = stripped[12]
  const version = parseInt(versionChar, 16)
  return Number.isNaN(version) ? null : version
}

/**
 * Translate a legacy v1 file id to a stable v2 id.
 * - UUID v7 → keep as-is (already v7)
 * - Everything else → deterministic uuidv5 in FILE_MIGRATION_NAMESPACE
 */
function translateId(oldId: string): string {
  const version = getUuidVersion(oldId)
  if (version === 7) return oldId
  return uuidv5(oldId, FILE_MIGRATION_NAMESPACE)
}

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
 * Falls back to Date.now() on parse failure (NaN).
 */
function parseTimestamp(dateStr: string | undefined | null): number {
  if (!dateStr) return Date.now()
  const ms = Date.parse(dateStr)
  return Number.isNaN(ms) ? Date.now() : ms
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
  /** Original v1 id — used for idRemap output */
  _oldId: string
}

/**
 * Determine origin and derive v2 fields from a v1 FileMetadata row.
 * Returns null if the row is malformed (missing required fields).
 */
function toFileEntry(row: FileMetadata, userData: string): PreparedFileEntry | null {
  if (!row.id || typeof row.id !== 'string' || row.id.trim() === '') return null
  if (!row.path || typeof row.path !== 'string' || row.path.trim() === '') return null
  if (!row.name || typeof row.name !== 'string' || row.name.trim() === '') return null

  const newId = translateId(row.id)
  const ext = normalizeExt(row.ext)
  const createdAt = parseTimestamp(row.created_at)

  // Origin discrimination: internal files live under userData/Data/Files/
  const internalPrefix = path.join(userData, 'Data', 'Files')
  const isInternal = row.path.startsWith(internalPrefix)

  if (isInternal) {
    return {
      id: newId,
      origin: 'internal',
      name: row.origin_name
        ? path.basename(row.origin_name, row.origin_name.includes('.') ? path.extname(row.origin_name) : '')
        : row.name,
      ext,
      size: typeof row.size === 'number' && row.size >= 0 ? row.size : 0,
      externalPath: null,
      trashedAt: null,
      createdAt,
      updatedAt: createdAt,
      _oldId: row.id
    }
  }

  // External file
  return {
    id: newId,
    origin: 'external',
    name: path.basename(row.path, path.extname(row.path)) || row.name,
    ext,
    size: null,
    externalPath: row.path,
    trashedAt: null,
    createdAt,
    updatedAt: createdAt,
    _oldId: row.id
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

          const entry = toFileEntry(row, ctx.paths.userData)
          if (!entry) {
            this.skippedCount += 1
            const label = row?.id ?? '(unknown)'
            this.recordWarning(`Skipped malformed file row (id=${label}): missing required fields`)
            continue
          }

          if (seenIds.has(entry.id)) {
            this.skippedCount += 1
            this.recordWarning(`Skipped duplicate file entry id=${entry._oldId} → ${entry.id}`)
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
      // Publish empty idRemap even when nothing to migrate
      ctx.sharedData.set('file.idRemap', new Map<string, string>())
      logger.info('FileMigrator.execute: no entries to migrate')
      return { success: true, processedCount: 0 }
    }

    const idRemap = new Map<string, string>()
    let processed = 0

    try {
      // Idempotency: fetch all existing v2 ids in chunked IN queries (avoids N+1)
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
          // Already migrated — still add to idRemap
          idRemap.set(entry._oldId, entry.id)
          processed += 1
        } else {
          entriesToInsert.push(entry)
        }
      }

      // Insert in batches within transactions
      for (let i = 0; i < entriesToInsert.length; i += BATCH_SIZE) {
        const batch = entriesToInsert.slice(i, i + BATCH_SIZE)

        await ctx.db.transaction(async (tx) => {
          // Build Drizzle-compatible rows (omit _oldId helper field)
          const rows = batch.map(({ _oldId: _o, ...rest }) => rest)
          await tx.insert(fileEntryTable).values(rows)
        })

        for (const entry of batch) {
          idRemap.set(entry._oldId, entry.id)
        }
        processed += batch.length

        const total = this.preparedEntries.length
        const progress = Math.round((processed / total) * 100)
        this.reportProgress(progress, `Migrated ${processed}/${total} file entries`, {
          key: 'migration.progress.migrated_files',
          params: { processed, total }
        })
      }

      ctx.sharedData.set('file.idRemap', idRemap)

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
