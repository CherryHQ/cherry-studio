/**
 * Translate Language Migrator - Migrates custom translate languages from Dexie to SQLite
 *
 * Data source: Dexie `translate_languages` table (exported as translate_languages.json)
 * Target table: `translateLanguageTable`
 *
 * Transformations:
 * - `createdAt` / `updatedAt`: generated as Date.now() (not present in old data)
 * - All other fields preserved as-is
 */

import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('TranslateLanguageMigrator')

interface OldCustomTranslateLanguage {
  id: string
  langCode: string
  value: string
  emoji: string
}

interface NewTranslateLanguage {
  id: string
  langCode: string
  value: string
  emoji: string
  createdAt: number
  updatedAt: number
}

function transformRecord(old: OldCustomTranslateLanguage): NewTranslateLanguage {
  const now = Date.now()
  return {
    id: old.id,
    langCode: old.langCode,
    value: old.value,
    emoji: old.emoji,
    createdAt: now,
    updatedAt: now
  }
}

export class TranslateLanguageMigrator extends BaseMigrator {
  readonly id = 'translate-language'
  readonly name = 'TranslateLanguage'
  readonly description = 'Migrate custom translate languages'
  readonly order = 6

  private sourceCount = 0
  private skippedCount = 0
  private cachedRecords: OldCustomTranslateLanguage[] = []

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const exists = await ctx.sources.dexieExport.tableExists('translate_languages')
      if (!exists) {
        logger.warn('translate_languages.json not found, skipping')
        return {
          success: true,
          itemCount: 0,
          warnings: ['translate_languages.json not found - no custom languages to migrate']
        }
      }

      this.cachedRecords = await ctx.sources.dexieExport.readTable<OldCustomTranslateLanguage>('translate_languages')
      this.sourceCount = this.cachedRecords.length
      logger.info(`Found ${this.sourceCount} custom translate languages to migrate`)

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

      const newRecords: NewTranslateLanguage[] = []
      for (const old of this.cachedRecords) {
        if (!old.id || !old.langCode || !old.value) {
          logger.warn(`Skipping invalid translate language record: ${old.id}`)
          this.skippedCount++
          continue
        }
        newRecords.push(transformRecord(old))
      }

      // Small dataset, single insert is fine
      if (newRecords.length > 0) {
        await db.insert(translateLanguageTable).values(newRecords)
        processedCount = newRecords.length
      }

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
      const result = await db.select({ count: sql<number>`count(*)` }).from(translateLanguageTable).get()
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
