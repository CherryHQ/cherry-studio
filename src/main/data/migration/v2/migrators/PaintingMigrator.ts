import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { paintingSourceType } from '@shared/data/types/file/ref'
import { inArray, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysInSequence } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'
import {
  LEGACY_PAINTING_NAMESPACES,
  type LegacyPaintingFileRefs,
  type LegacyPaintingsState,
  type NormalizedPaintingRow,
  transformLegacyPaintingRecord
} from './mappings/PaintingMappings'

const logger = loggerService.withContext('PaintingMigrator')

const INSERT_BATCH_SIZE = 100

export class PaintingMigrator extends BaseMigrator {
  readonly id = 'painting'
  readonly name = 'Painting'
  readonly description = 'Migrate painting history from Redux to SQLite'
  readonly order = 4.5

  private sourceCount = 0
  private skippedCount = 0
  private preparedPaintings: Array<typeof paintingTable.$inferInsert> = []
  /**
   * `painting.id` → output/input file ids extracted from the legacy record.
   * Resolved against `file_entry` at execute() time so we never insert a
   * `file_ref` row with a dangling FK (legacy rows can reference file ids
   * that the FileMigrator skipped as malformed).
   */
  private preparedFileRefs = new Map<string, LegacyPaintingFileRefs>()
  private droppedFileRefs = 0
  private warnings: string[] = []

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.preparedPaintings = []
    this.preparedFileRefs = new Map()
    this.droppedFileRefs = 0
    this.warnings = []
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const state = ctx.sources.reduxState.getCategory<LegacyPaintingsState>('paintings')
      if (!state || typeof state !== 'object') {
        return {
          success: true,
          itemCount: 0,
          warnings: ['No painting Redux state found - skipping painting migration']
        }
      }

      const stateKeys = Object.keys(state)
      logger.info('[prepare] paintings state loaded', {
        keys: stateKeys.join(','),
        namespaceCounts: stateKeys
          .map((k) => `${k}:${Array.isArray(state[k]) ? (state[k] as unknown[]).length : typeof state[k]}`)
          .join(', ')
      })

      const groupedRecords = new Map<string, Array<{ row: NormalizedPaintingRow; files: LegacyPaintingFileRefs }>>()
      const seenIds = new Set<string>()
      const normalizedRows: NormalizedPaintingRow[] = []

      for (const namespace of LEGACY_PAINTING_NAMESPACES) {
        const records = Array.isArray(state[namespace]) ? (state[namespace] as Array<Record<string, unknown>>) : []

        for (let index = 0; index < records.length; index++) {
          this.sourceCount++
          const result = transformLegacyPaintingRecord(namespace, records[index])

          if (!result.ok) {
            this.skippedCount++
            if (result.reason === 'missing_id') {
              this.warnings.push(`Skipped ${namespace}[${index}] because it has no id`)
            } else {
              this.warnings.push(`Skipped ${namespace}[${index}] because it is an empty placeholder`)
            }
            this.warnings.push(...result.warnings.map((warning) => `${namespace}[${index}]: ${warning}`))
            continue
          }

          const normalized = { ...result.value }
          if (seenIds.has(normalized.id)) {
            const duplicateId = normalized.id
            normalized.id = uuidv4()
            this.warnings.push(`Rewrote duplicate painting id '${duplicateId}' to '${normalized.id}' during migration`)
          }
          seenIds.add(normalized.id)
          this.preparedFileRefs.set(normalized.id, result.files)

          this.warnings.push(...result.warnings.map((warning) => `${namespace}[${index}]: ${warning}`))

          const namespaceEntries = groupedRecords.get(namespace) ?? []
          namespaceEntries.push({ row: normalized, files: result.files })
          groupedRecords.set(namespace, namespaceEntries)
        }
      }

      for (const entries of groupedRecords.values()) {
        normalizedRows.push(...entries.map((e) => e.row))
      }
      this.preparedPaintings = assignOrderKeysInSequence(normalizedRows)

      logger.info('Prepared painting migration records', {
        sourceCount: this.sourceCount,
        skippedCount: this.skippedCount,
        preparedCount: this.preparedPaintings.length
      })

      return {
        success: true,
        itemCount: this.sourceCount,
        warnings: this.warnings.length > 0 ? this.warnings : undefined
      }
    } catch (error) {
      logger.error('Prepare failed', error as Error)
      return {
        success: false,
        itemCount: this.sourceCount,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedPaintings.length === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      const paintings = this.preparedPaintings

      logger.info('[execute] insert summary', { total: paintings.length })

      await ctx.db.transaction(async (tx) => {
        for (let index = 0; index < paintings.length; index += INSERT_BATCH_SIZE) {
          const batch = paintings.slice(index, index + INSERT_BATCH_SIZE)
          await tx.insert(paintingTable).values(batch)

          this.reportProgress(
            Math.round((Math.min(index + INSERT_BATCH_SIZE, paintings.length) / paintings.length) * 100),
            `Migrated ${Math.min(index + INSERT_BATCH_SIZE, paintings.length)}/${paintings.length} painting records`
          )
        }

        // ─── file_ref rows ───
        // Legacy painting rows carry output/input `file_entry.id`s in JSON.
        // The v2 schema dropped that column; emit `file_ref` rows so the
        // painting still points at its files via the new (sourceType,
        // sourceId, role) trio. File ids that the FileMigrator skipped
        // (malformed v1 rows) are filtered out here to avoid FK violations
        // — they would be silently dropped by `inArray`, but we count them
        // explicitly so the validate() step has a stat to report.
        const allFileIds = new Set<string>()
        for (const { output, input } of this.preparedFileRefs.values()) {
          for (const id of output) allFileIds.add(id)
          for (const id of input) allFileIds.add(id)
        }
        if (allFileIds.size > 0) {
          const idList = Array.from(allFileIds)
          const existing = await tx
            .select({ id: fileEntryTable.id })
            .from(fileEntryTable)
            .where(inArray(fileEntryTable.id, idList))
          const existingIds = new Set(existing.map((r) => r.id))

          const now = Date.now()
          const refRows: Array<typeof fileRefTable.$inferInsert> = []
          for (const [paintingId, files] of this.preparedFileRefs) {
            for (const fileId of files.output) {
              if (!existingIds.has(fileId)) {
                this.droppedFileRefs += 1
                continue
              }
              refRows.push({
                id: uuidv4(),
                fileEntryId: fileId,
                sourceType: paintingSourceType,
                sourceId: paintingId,
                role: 'output',
                createdAt: now,
                updatedAt: now
              })
            }
            for (const fileId of files.input) {
              if (!existingIds.has(fileId)) {
                this.droppedFileRefs += 1
                continue
              }
              refRows.push({
                id: uuidv4(),
                fileEntryId: fileId,
                sourceType: paintingSourceType,
                sourceId: paintingId,
                role: 'input',
                createdAt: now,
                updatedAt: now
              })
            }
          }

          for (let i = 0; i < refRows.length; i += INSERT_BATCH_SIZE) {
            const batch = refRows.slice(i, i + INSERT_BATCH_SIZE)
            await tx.insert(fileRefTable).values(batch).onConflictDoNothing()
          }

          logger.info('[execute] painting file_ref summary', {
            referenced: refRows.length,
            droppedDangling: this.droppedFileRefs
          })
        }
      })

      return {
        success: true,
        processedCount: paintings.length
      }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const countResult = await ctx.db.select({ count: sql<number>`count(*)` }).from(paintingTable).get()
      const targetCount = countResult?.count ?? 0
      const errors: Array<{ key: string; message: string }> = []

      if (targetCount !== this.preparedPaintings.length) {
        errors.push({
          key: 'painting_count_mismatch',
          message: `Expected ${this.preparedPaintings.length} painting rows but found ${targetCount}`
        })
      }

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
      logger.error('Validate failed', error as Error)
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
