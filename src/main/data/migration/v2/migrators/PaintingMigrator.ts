import { paintingTable } from '@data/db/schemas/painting'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysInSequence } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'
import {
  LEGACY_PAINTING_NAMESPACES,
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

      const stateKeys = Object.keys(state)
      logger.info('[prepare] paintings state loaded', {
        keys: stateKeys.join(','),
        namespaceCounts: stateKeys
          .map((k) => `${k}:${Array.isArray(state[k]) ? (state[k] as unknown[]).length : typeof state[k]}`)
          .join(', ')
      })

      const groupedRecords = new Map<string, NormalizedPaintingRow[]>()
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
            normalized.id = `${duplicateId}_${namespace}_${index}`
            this.warnings.push(`Rewrote duplicate painting id '${duplicateId}' to '${normalized.id}' during migration`)
          }
          seenIds.add(normalized.id)

          this.warnings.push(...result.warnings.map((warning) => `${namespace}[${index}]: ${warning}`))

          const namespaceEntries = groupedRecords.get(namespace) ?? []
          namespaceEntries.push(normalized)
          groupedRecords.set(namespace, namespaceEntries)
        }
      }

      for (const entries of groupedRecords.values()) {
        normalizedRows.push(...entries)
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
