import { paintingTable } from '@data/db/schemas/painting'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'
import {
  LEGACY_PAINTING_NAMESPACES,
  type LegacyPaintingsState,
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
  private warnings: string[] = []

  override reset(): void {
    this.sourceCount = 0
    this.skippedCount = 0
    this.preparedPaintings = []
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

      // --- DEBUG: log raw source data shape ---
      const stateKeys = Object.keys(state)
      logger.info('[prepare] paintings state loaded', {
        keys: stateKeys.join(','),
        namespaceCounts: stateKeys
          .map((k) => `${k}:${Array.isArray(state[k]) ? (state[k] as unknown[]).length : typeof state[k]}`)
          .join(', ')
      })

      // Log a sample record from the first non-empty namespace
      for (const ns of stateKeys) {
        const arr = state[ns]
        if (Array.isArray(arr) && arr.length > 0) {
          const sample = arr[0] as Record<string, unknown>
          logger.info('[prepare] sample record from ' + ns, {
            keys: Object.keys(sample).join(','),
            id: sample.id,
            hasFiles: 'files' in sample,
            filesType: typeof sample.files,
            filesIsArray: Array.isArray(sample.files),
            filesLength: Array.isArray(sample.files) ? sample.files.length : 'N/A',
            filesSample: JSON.stringify(sample.files)?.slice(0, 500)
          })
          break
        }
      }

      const groupedRecords = new Map<string, Array<typeof paintingTable.$inferInsert>>()
      const seenIds = new Set<string>()

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
            normalized.id = `${duplicateId}_${namespace}_${index}`
            this.warnings.push(`Rewrote duplicate painting id '${duplicateId}' to '${normalized.id}' during migration`)
          }
          seenIds.add(normalized.id)

          this.warnings.push(...result.warnings.map((warning) => `${namespace}[${index}]: ${warning}`))

          const namespaceEntries = groupedRecords.get(namespace) ?? []
          namespaceEntries.push({
            ...normalized,
            sortOrder: 0
          })
          groupedRecords.set(namespace, namespaceEntries)
        }
      }

      for (const entries of groupedRecords.values()) {
        entries.forEach((entry, index) => {
          entry.sortOrder = entries.length - index
          this.preparedPaintings.push(entry)
        })
      }

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
      // --- DEBUG: log what we're about to insert ---
      const withFiles = this.preparedPaintings.filter((p) => p.files && p.files.output.length > 0)
      const withoutFiles = this.preparedPaintings.filter((p) => !p.files || p.files.output.length === 0)
      logger.info('[execute] insert summary', {
        total: this.preparedPaintings.length,
        withFiles: withFiles.length,
        withoutFiles: withoutFiles.length,
        sampleWithFiles:
          withFiles.length > 0
            ? JSON.stringify({ id: withFiles[0].id, files: withFiles[0].files })?.slice(0, 300)
            : 'none',
        sampleWithoutFiles:
          withoutFiles.length > 0
            ? JSON.stringify({ id: withoutFiles[0].id, files: withoutFiles[0].files })?.slice(0, 300)
            : 'none'
      })

      await ctx.db.transaction(async (tx) => {
        for (let index = 0; index < this.preparedPaintings.length; index += INSERT_BATCH_SIZE) {
          const batch = this.preparedPaintings.slice(index, index + INSERT_BATCH_SIZE)
          await tx.insert(paintingTable).values(batch)

          this.reportProgress(
            Math.round(
              (Math.min(index + INSERT_BATCH_SIZE, this.preparedPaintings.length) / this.preparedPaintings.length) * 100
            ),
            `Migrated ${Math.min(index + INSERT_BATCH_SIZE, this.preparedPaintings.length)}/${this.preparedPaintings.length} painting records`
          )
        }
      })

      return {
        success: true,
        processedCount: this.preparedPaintings.length
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
