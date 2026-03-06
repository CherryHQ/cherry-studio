/**
 * Translate History Migrator - Migrates translate history from Dexie to SQLite
 *
 * Data source: Dexie `translate_history` table (exported as translate_history.json)
 * Target table: `translateHistoryTable`
 *
 * Transformations:
 * - `createdAt`: ISO string → integer timestamp (fallback to Date.now() if parse fails)
 * - `star`: preserved as boolean
 * - `updatedAt`: generated as same value as createdAt (not present in old data)
 */

import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('TranslateHistoryMigrator')

const INSERT_BATCH_SIZE = 100

interface OldTranslateHistory {
  id: string
  sourceText: string
  targetText: string
  sourceLanguage: string
  targetLanguage: string
  createdAt: string
  star?: boolean
}

interface NewTranslateHistory {
  id: string
  sourceText: string
  targetText: string
  sourceLanguage: string
  targetLanguage: string
  star: boolean
  createdAt: number
  updatedAt: number
}

function transformRecord(old: OldTranslateHistory): NewTranslateHistory {
  const createdAt = new Date(old.createdAt).getTime() || Date.now()
  return {
    id: old.id,
    sourceText: old.sourceText,
    targetText: old.targetText,
    sourceLanguage: old.sourceLanguage,
    targetLanguage: old.targetLanguage,
    star: old.star ?? false,
    createdAt,
    updatedAt: createdAt
  }
}

export class TranslateHistoryMigrator extends BaseMigrator {
  readonly id = 'translate-history'
  readonly name = 'TranslateHistory'
  readonly description = 'Migrate translate history'
  readonly order = 5

  private sourceCount = 0
  private skippedCount = 0
  private cachedRecords: OldTranslateHistory[] = []

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const exists = await ctx.sources.dexieExport.tableExists('translate_history')
      if (!exists) {
        logger.warn('translate_history.json not found, skipping')
        return {
          success: true,
          itemCount: 0,
          warnings: ['translate_history.json not found - no translate history to migrate']
        }
      }

      this.cachedRecords = await ctx.sources.dexieExport.readTable<OldTranslateHistory>('translate_history')
      this.sourceCount = this.cachedRecords.length
      logger.info(`Found ${this.sourceCount} translate history records to migrate`)

      return {
        success: true,
        itemCount: this.sourceCount
      }
    } catch (error) {
      logger.error('Prepare failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.sourceCount === 0) {
      return { success: true, processedCount: 0 }
    }

    let processedCount = 0

    try {
      const db = ctx.db

      const newRecords: NewTranslateHistory[] = []
      for (const old of this.cachedRecords) {
        if (!old.id || !old.sourceText || !old.targetText) {
          logger.warn(`Skipping invalid translate history record: ${old.id}`)
          this.skippedCount++
          continue
        }
        newRecords.push(transformRecord(old))
      }

      // Insert in batches within a transaction
      await db.transaction(async (tx) => {
        for (let i = 0; i < newRecords.length; i += INSERT_BATCH_SIZE) {
          const batch = newRecords.slice(i, i + INSERT_BATCH_SIZE)
          await tx.insert(translateHistoryTable).values(batch)
          processedCount += batch.length

          const progress = Math.round((processedCount / newRecords.length) * 100)
          this.reportProgress(progress, `Migrated ${processedCount}/${newRecords.length} translate history records`, {
            key: 'migration.progress.migrated_translate_history',
            params: { processed: processedCount, total: newRecords.length }
          })
        }
      })

      logger.info('Execute completed', { processedCount, skipped: this.skippedCount })

      return { success: true, processedCount }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const errors: ValidationError[] = []
    const db = ctx.db

    try {
      const result = await db.select({ count: sql<number>`count(*)` }).from(translateHistoryTable).get()
      const targetCount = result?.count ?? 0

      const expectedCount = this.sourceCount - this.skippedCount
      if (targetCount < expectedCount) {
        errors.push({
          key: 'count_mismatch',
          message: `Expected ${expectedCount} records, got ${targetCount}`
        })
      }

      logger.info('Validation completed', {
        sourceCount: this.sourceCount,
        targetCount,
        skippedCount: this.skippedCount
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
      logger.error('Validation failed', error as Error)
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
