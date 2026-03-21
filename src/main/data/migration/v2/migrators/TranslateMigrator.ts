/**
 * Translate Migrator - Migrates translate history and custom languages from Dexie to SQLite
 *
 * Handles two tables in a single migrator since they belong to the same feature domain:
 *
 * 1. translate_history → translateHistoryTable
 *    - `createdAt`: ISO string → integer timestamp (fallback to Date.now() if parse fails)
 *    - `star`: preserved as boolean
 *    - `updatedAt`: generated as same value as createdAt (not present in old data)
 *
 * 2. translate_languages → translateLanguageTable
 *    - `createdAt` / `updatedAt`: generated as Date.now() (not present in old data)
 *    - All other fields preserved as-is
 */

import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { translateLanguageTable } from '@data/db/schemas/translateLanguage'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('TranslateMigrator')

const HISTORY_BATCH_SIZE = 100

// ─── Old data interfaces ────────────────────────────────────────────

interface OldTranslateHistory {
  id: string
  sourceText: string
  targetText: string
  sourceLanguage: string
  targetLanguage: string
  createdAt: string
  star?: boolean
}

interface OldCustomTranslateLanguage {
  id: string
  langCode: string
  value: string
  emoji: string
}

// ─── New data interfaces ────────────────────────────────────────────

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

interface NewTranslateLanguage {
  id: string
  langCode: string
  value: string
  emoji: string
  createdAt: number
  updatedAt: number
}

// ─── Transform functions ────────────────────────────────────────────

function parseTimestamp(value: string): number {
  if (!value) return Date.now()
  const parsed = new Date(value).getTime()
  return !parsed || Number.isNaN(parsed) ? Date.now() : parsed
}

function transformHistoryRecord(old: OldTranslateHistory): NewTranslateHistory {
  const createdAt = parseTimestamp(old.createdAt)
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

function transformLanguageRecord(old: OldCustomTranslateLanguage, now: number): NewTranslateLanguage {
  return {
    id: old.id,
    langCode: old.langCode,
    value: old.value,
    emoji: old.emoji,
    createdAt: now,
    updatedAt: now
  }
}

// ─── Migrator ───────────────────────────────────────────────────────

export class TranslateMigrator extends BaseMigrator {
  readonly id = 'translate'
  readonly name = 'Translate'
  readonly description = 'Migrate translate history and custom languages'
  readonly order = 5

  private historySourceCount = 0
  private historySkippedCount = 0
  private cachedHistoryRecords: OldTranslateHistory[] = []

  private languageSourceCount = 0
  private languageSkippedCount = 0
  private cachedLanguageRecords: OldCustomTranslateLanguage[] = []

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    const warnings: string[] = []

    try {
      // Prepare translate history
      const historyExists = await ctx.sources.dexieExport.tableExists('translate_history')
      if (!historyExists) {
        logger.warn('translate_history.json not found, skipping')
        warnings.push('translate_history.json not found - no translate history to migrate')
      } else {
        this.cachedHistoryRecords = await ctx.sources.dexieExport.readTable<OldTranslateHistory>('translate_history')
        this.historySourceCount = this.cachedHistoryRecords.length
        logger.info(`Found ${this.historySourceCount} translate history records to migrate`)
      }

      // Prepare translate languages
      const languageExists = await ctx.sources.dexieExport.tableExists('translate_languages')
      if (!languageExists) {
        logger.warn('translate_languages.json not found, skipping')
        warnings.push('translate_languages.json not found - no custom languages to migrate')
      } else {
        this.cachedLanguageRecords =
          await ctx.sources.dexieExport.readTable<OldCustomTranslateLanguage>('translate_languages')
        this.languageSourceCount = this.cachedLanguageRecords.length
        logger.info(`Found ${this.languageSourceCount} custom translate languages to migrate`)
      }

      return {
        success: true,
        itemCount: this.historySourceCount + this.languageSourceCount,
        warnings: warnings.length > 0 ? warnings : undefined
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
    const totalCount = this.historySourceCount + this.languageSourceCount
    if (totalCount === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      const db = ctx.db
      let processedCount = 0

      // ── Migrate translate history (batched) ──
      if (this.historySourceCount > 0) {
        const newHistoryRecords: NewTranslateHistory[] = []
        for (const old of this.cachedHistoryRecords) {
          if (!old.id || !old.sourceText || !old.targetText || !old.sourceLanguage || !old.targetLanguage) {
            logger.warn(`Skipping invalid translate history record: ${old.id}`)
            this.historySkippedCount++
            continue
          }
          newHistoryRecords.push(transformHistoryRecord(old))
        }

        await db.transaction(async (tx) => {
          for (let i = 0; i < newHistoryRecords.length; i += HISTORY_BATCH_SIZE) {
            const batch = newHistoryRecords.slice(i, i + HISTORY_BATCH_SIZE)
            await tx.insert(translateHistoryTable).values(batch)

            const historyProcessed = Math.min(i + HISTORY_BATCH_SIZE, newHistoryRecords.length)
            const progress = Math.round((historyProcessed / totalCount) * 100)
            this.reportProgress(
              progress,
              `Migrated ${historyProcessed}/${newHistoryRecords.length} translate history records`,
              {
                key: 'migration.progress.migrated_translate_history',
                params: { processed: historyProcessed, total: newHistoryRecords.length }
              }
            )
          }
        })

        processedCount += newHistoryRecords.length
        logger.info('Translate history migration completed', {
          processedCount: newHistoryRecords.length,
          skipped: this.historySkippedCount
        })
      }

      // ── Migrate translate languages (single batch) ──
      if (this.languageSourceCount > 0) {
        const now = Date.now()
        const newLanguageRecords: NewTranslateLanguage[] = []
        for (const old of this.cachedLanguageRecords) {
          if (!old.id || !old.langCode || !old.value || !old.emoji) {
            logger.warn(`Skipping invalid translate language record: ${old.id}`)
            this.languageSkippedCount++
            continue
          }
          newLanguageRecords.push(transformLanguageRecord(old, now))
        }

        if (newLanguageRecords.length > 0) {
          await db.transaction(async (tx) => {
            await tx.insert(translateLanguageTable).values(newLanguageRecords)
          })
          processedCount += newLanguageRecords.length
        }

        this.reportProgress(100, `Migrated ${newLanguageRecords.length} custom translate languages`, {
          key: 'migration.progress.migrated_translate_languages',
          params: { processed: newLanguageRecords.length, total: newLanguageRecords.length }
        })

        logger.info('Translate language migration completed', {
          processedCount: newLanguageRecords.length,
          skipped: this.languageSkippedCount
        })
      }

      return { success: true, processedCount }
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
    const errors: ValidationError[] = []
    const db = ctx.db

    try {
      // Validate translate history
      const historyResult = await db.select({ count: sql<number>`count(*)` }).from(translateHistoryTable).get()
      const historyTargetCount = historyResult?.count ?? 0
      const expectedHistoryCount = this.historySourceCount - this.historySkippedCount

      if (historyTargetCount < expectedHistoryCount) {
        errors.push({
          key: 'history_count_mismatch',
          message: `Expected ${expectedHistoryCount} history records, got ${historyTargetCount}`
        })
      }

      // Validate translate languages
      const languageResult = await db.select({ count: sql<number>`count(*)` }).from(translateLanguageTable).get()
      const languageTargetCount = languageResult?.count ?? 0
      const expectedLanguageCount = this.languageSourceCount - this.languageSkippedCount

      if (languageTargetCount < expectedLanguageCount) {
        errors.push({
          key: 'language_count_mismatch',
          message: `Expected ${expectedLanguageCount} language records, got ${languageTargetCount}`
        })
      }

      logger.info('Validation completed', {
        historySourceCount: this.historySourceCount,
        historyTargetCount,
        historySkippedCount: this.historySkippedCount,
        languageSourceCount: this.languageSourceCount,
        languageTargetCount,
        languageSkippedCount: this.languageSkippedCount
      })

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.historySourceCount + this.languageSourceCount,
          targetCount: historyTargetCount + languageTargetCount,
          skippedCount: this.historySkippedCount + this.languageSkippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.historySourceCount + this.languageSourceCount,
          targetCount: 0,
          skippedCount: this.historySkippedCount + this.languageSkippedCount
        }
      }
    }
  }
}
