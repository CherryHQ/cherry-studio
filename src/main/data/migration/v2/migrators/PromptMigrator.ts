/**
 * Prompt migrator - migrates quick phrases from Dexie to SQLite prompt table
 *
 * Data sources:
 *   - Dexie quick_phrases table
 * Target tables:
 *   - prompt (with auto-generated v1 version in prompt_version)
 *
 * Mapping:
 *   QuickPhrase.id        → prompt.id
 *   QuickPhrase.title     → prompt.title
 *   QuickPhrase.content   → prompt.content (${var} syntax preserved)
 *   QuickPhrase.order     → prompt.sortOrder
 *   QuickPhrase.createdAt → prompt.createdAt
 *   QuickPhrase.updatedAt → prompt.updatedAt
 *   (default)             → prompt.currentVersion = 1
 */

import { promptTable, promptVersionTable } from '@data/db/schemas/prompt'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('PromptMigrator')

/** Legacy QuickPhrase shape from Dexie */
interface LegacyQuickPhrase {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
  order?: number
}

export class PromptMigrator extends BaseMigrator {
  readonly id = 'prompt'
  readonly name = 'Prompts'
  readonly description = 'Migrate quick phrases to prompts'
  readonly order = 5

  private promptCount = 0
  private skippedCount = 0
  private preparedPhrases: LegacyQuickPhrase[] = []

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const exists = await ctx.sources.dexieExport.tableExists('quick_phrases')
      if (!exists) {
        logger.info('quick_phrases table not found, skipping')
        return {
          success: true,
          itemCount: 0,
          warnings: ['quick_phrases table not found - skipping']
        }
      }

      const phrases = await ctx.sources.dexieExport.readTable<LegacyQuickPhrase>('quick_phrases')
      this.preparedPhrases = phrases.filter((p) => p.id && p.content)
      this.skippedCount = phrases.length - this.preparedPhrases.length
      this.promptCount = this.preparedPhrases.length

      if (this.skippedCount > 0) {
        logger.warn('Skipped invalid quick phrases', { skipped: this.skippedCount })
      }

      logger.info('Prepared prompt migration', { count: this.promptCount, skipped: this.skippedCount })

      return {
        success: true,
        itemCount: this.promptCount,
        warnings: this.skippedCount > 0 ? [`Skipped ${this.skippedCount} invalid quick phrases`] : undefined
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
    if (this.promptCount === 0) {
      return { success: true, processedCount: 0 }
    }

    let processedCount = 0

    try {
      const db = ctx.db

      await db.transaction(async (tx) => {
        for (let i = 0; i < this.preparedPhrases.length; i++) {
          const phrase = this.preparedPhrases[i]

          // Insert prompt
          await tx.insert(promptTable).values({
            id: phrase.id,
            title: phrase.title || 'Untitled',
            content: phrase.content,
            currentVersion: 1,
            sortOrder: phrase.order ?? i,
            createdAt: phrase.createdAt,
            updatedAt: phrase.updatedAt
          })

          // Create v1 version snapshot
          await tx.insert(promptVersionTable).values({
            promptId: phrase.id,
            version: 1,
            content: phrase.content,
            createdAt: phrase.createdAt
          })

          processedCount++

          // Report progress every 10 items
          if (processedCount % 10 === 0 || processedCount === this.promptCount) {
            this.reportProgress(
              Math.round((processedCount / this.promptCount) * 100),
              `Migrated ${processedCount}/${this.promptCount} prompts`
            )
          }
        }
      })

      logger.info('Prompt migration completed', { processedCount })
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
      // Count prompts in target
      const promptResult = await db.select({ count: sql<number>`count(*)` }).from(promptTable).get()
      const targetCount = promptResult?.count ?? 0

      // Count versions in target
      const versionResult = await db.select({ count: sql<number>`count(*)` }).from(promptVersionTable).get()
      const targetVersionCount = versionResult?.count ?? 0

      logger.info('Validation counts', {
        sourceCount: this.promptCount,
        targetPromptCount: targetCount,
        targetVersionCount,
        skippedCount: this.skippedCount
      })

      // promptCount is already the filtered (valid) count
      if (targetCount < this.promptCount) {
        errors.push({
          key: 'prompt_count_mismatch',
          expected: this.promptCount,
          actual: targetCount,
          message: `Expected at least ${this.promptCount} prompts, got ${targetCount}`
        })
      }

      // Each prompt should have exactly one version (v1)
      if (targetVersionCount < targetCount) {
        errors.push({
          key: 'version_count_mismatch',
          expected: targetCount,
          actual: targetVersionCount,
          message: `Expected at least ${targetCount} versions, got ${targetVersionCount}`
        })
      }

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.promptCount,
          targetCount,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      errors.push({
        key: 'validation_error',
        message: error instanceof Error ? error.message : String(error)
      })
      return {
        success: false,
        errors,
        stats: {
          sourceCount: this.promptCount,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
