/** Migrates legacy v1 Dexie `files` table into the v2 `file_entry` SQLite table. */

import fs from 'node:fs'
import path from 'node:path'

import { fileEntryTable } from '@data/db/schemas/file'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { FileEntrySchema } from '@shared/data/types/file'
import { SafeExtSchema, SafeNameSchema } from '@shared/data/types/file/essential'
import type { FileMetadata } from '@shared/data/types/file/legacyFileMetadata'
import { sql } from 'drizzle-orm'

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

/**
 * Last path segment, treating both '/' and '\' as separators. v1 rows can
 * carry foreign-platform paths (#15733), so platform-default `path.basename`
 * must never be applied to v1-persisted strings.
 */
function basenameAnySep(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

/** Strip a trailing `.ext`; leading-dot names (`.gitignore`) stay intact. */
function stripExt(base: string): string {
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * Derive a SafeNameSchema-conformant display name from the v1 name source.
 *
 * Degradation chain: raw → sanitized (last segment, trimmed) → row id.
 * Never asks the caller to skip the row: a skipped internal row strands
 * its physical file, which the user-triggered FS orphan sweep
 * (`File_RunSweep`; no startup auto-run) then reclaims — real data loss.
 * `name` does not participate in physical paths (`{id}.{ext}`), so
 * degrading it is always safe.
 */
function deriveSafeName(nameSource: string, rowId: string, onWarning: (message: string) => void): string {
  const raw = stripExt(nameSource)
  if (SafeNameSchema.safeParse(raw).success) return raw

  const sanitized = stripExt(basenameAnySep(nameSource)).trim()
  if (SafeNameSchema.safeParse(sanitized).success) {
    onWarning(`Sanitized name for file id=${rowId}: ${JSON.stringify(nameSource)} -> ${JSON.stringify(sanitized)}`)
    return sanitized
  }

  onWarning(`Name for file id=${rowId} cannot be sanitized; falling back to row id. raw=${JSON.stringify(nameSource)}`)
  return rowId
}

/**
 * v1 semantically has no external entries — rows were only persisted after
 * upload, so every migratable row is internal. Mirrors the DB CHECKs
 * (`fe_origin_consistency`, `fe_size_internal_only`) in TS.
 */
interface PreparedFileEntry {
  id: string
  origin: 'internal'
  name: string
  ext: string | null
  size: number
  externalPath: null
  deletedAt: null
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

  const normalizedExt = normalizeExt(row.ext)
  let ext: string | null = null
  if (normalizedExt !== null) {
    const parsedExt = SafeExtSchema.safeParse(normalizedExt)
    if (!parsedExt.success) {
      // ext column has no DB CHECK, so a malformed value would silently land
      // in v2 and only blow up at row-read time via FileEntrySchema.parse.
      // Treat as malformed row instead — the caller skips it with a warning.
      onWarning(`Invalid ext for file id=${row.id}; treating row as malformed. raw=${JSON.stringify(row.ext)}`)
      return null
    }
    ext = parsedExt.data
  }

  const createdAt = parseTimestamp(row.created_at, (raw) => {
    onWarning(`Invalid created_at for file id=${row.id}; falling back to migration time. raw=${JSON.stringify(raw)}`)
  })

  // Origin discrimination. v1 has no external entries (rows persisted only
  // after upload), and v1 runtime locates physical files by storage name
  // (`row.name` = `{id}{ext}`), never via the `path` column — so a backup
  // restored across platforms carries foreign-separator paths that fail the
  // prefix check even though the file sits right here (#15733). Trust the
  // filesystem over the stale path string before declaring a row orphaned.
  const internalPrefix = path.join(userData, 'Data', 'Files')
  const physicalPath = path.join(internalPrefix, row.name)
  const isInternal = row.path.startsWith(internalPrefix) || fs.existsSync(physicalPath)

  if (!isInternal) {
    // Neither under the internal dir nor physically present: dead metadata
    // left by incomplete v1 deletes. Do not fabricate an external entry —
    // downstream migrators (Chat/Painting) already resolve file_ref against
    // file_entry, so skipping cannot create dangling FKs.
    onWarning(
      `Orphan file row id=${row.id}: no physical file and path is not internal; skipping. path=${JSON.stringify(row.path)}`
    )
    return null
  }

  // size column has a DB CHECK but accepts 0 (legitimate empty files), so a
  // garbage v1 size cannot simply be coerced to 0 — it would land
  // indistinguishably as an empty file in the v2 UI. Skipping outright is
  // worse: every row reaching this point is internal, so a physically
  // present file would be stranded and become eligible for the
  // user-triggered FS orphan sweep (`File_RunSweep`) — real data loss for
  // recoverable content. Recover the true size from disk instead; skip only
  // when the disk holds nothing recoverable.
  let size: number
  if (typeof row.size === 'number' && row.size >= 0) {
    size = row.size
  } else {
    try {
      size = fs.statSync(physicalPath).size
      onWarning(`Invalid size for file id=${row.id}; recovered size=${size} from disk. raw=${JSON.stringify(row.size)}`)
    } catch {
      onWarning(
        `Invalid size for file id=${row.id} and physical file is unreadable; skipping row. raw=${JSON.stringify(row.size)}`
      )
      return null
    }
  }

  const entry: PreparedFileEntry = {
    id: row.id,
    origin: 'internal',
    name: deriveSafeName(row.origin_name || row.name, row.id, onWarning),
    ext,
    size,
    externalPath: null,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt
  }

  // Write-side validation must be >= read-side validation. Probe
  // through the same schema the runtime read path applies (rowToFileEntry →
  // FileEntrySchema.parse) so a malformed row can never reach SQLite and
  // detonate at read time (#15733). Unreachable by construction today —
  // this guards future field/schema drift.
  const probe = FileEntrySchema.safeParse({
    id: entry.id,
    origin: 'internal',
    name: entry.name,
    ext: entry.ext,
    size: entry.size,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt
  })
  if (!probe.success) {
    onWarning(
      `Prepared entry for file id=${row.id} failed read-schema validation; skipping. issues=${JSON.stringify(probe.error.issues)}`
    )
    return null
  }

  return entry
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
            this.recordWarning(`Skipped unmigratable file row (id=${label})`)
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
      for (let i = 0; i < this.preparedEntries.length; i += BATCH_SIZE) {
        const batch = this.preparedEntries.slice(i, i + BATCH_SIZE)

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

      // Sample physical files for internal entries. Missing physical files are
      // a real condition on v1 installs — users delete `~/.../Data/Files/*`
      // outside Cherry, leaving dangling metadata. Surfacing it as a fatal
      // validation error aborts the whole migration over data that the
      // user-triggered FS orphan sweep (`File_RunSweep`) can clean up later.
      // Record as a non-fatal warning so the migration log carries the
      // diagnostic trail but the engine still proceeds to downstream
      // migrators.
      const internalEntries = this.preparedEntries.slice(0, VALIDATE_SAMPLE_LIMIT)

      let missingPhysical = 0
      for (const entry of internalEntries) {
        const physicalPath = path.join(
          ctx.paths.userData,
          'Data',
          'Files',
          entry.ext ? `${entry.id}.${entry.ext}` : entry.id
        )
        if (!fs.existsSync(physicalPath)) {
          missingPhysical += 1
          this.recordWarning(`Physical file missing for entry id=${entry.id}: ${physicalPath}`)
        }
      }

      logger.info('FileMigrator.validate completed', {
        sourceCount: this.sourceCount,
        targetCount,
        skippedCount: this.skippedCount,
        missingPhysicalSampled: missingPhysical,
        sampleSize: internalEntries.length,
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
