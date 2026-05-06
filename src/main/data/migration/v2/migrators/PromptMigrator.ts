/**
 * Prompt migrator - migrates quick phrases from Dexie to SQLite prompt table.
 *
 * Mapping:
 *   (new uuidv7)          → prompt.id (legacy QuickPhrase.id was uuidv4 and would
 *                           fail PromptIdSchema's z.uuidv7() validation; nothing
 *                           external references the old id so we regenerate)
 *   QuickPhrase.title     → prompt.title (fallback 'Untitled')
 *   QuickPhrase.content   → prompt.content (${var} syntax preserved)
 *   QuickPhrase.order     → drives relative order; stamped as fractional-indexing `orderKey`
 *   QuickPhrase.createdAt → prompt.createdAt
 *   QuickPhrase.updatedAt → prompt.updatedAt
 */

import { promptTable } from '@data/db/schemas/prompt'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysInSequence } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('PromptMigrator')

/** Legacy QuickPhrase shape from Dexie. */
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
  private prepareError: string | null = null
  private preparedPhrases: LegacyQuickPhrase[] = []

  override reset(): void {
    this.promptCount = 0
    this.skippedCount = 0
    this.prepareError = null
    this.preparedPhrases = []
  }

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
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Prepare failed', error as Error)
      this.prepareError = message
      return {
        success: false,
        itemCount: 0,
        error: message
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.promptCount === 0) {
      return { success: true, processedCount: 0 }
    }

    // Stamp fractional-indexing orderKeys after sorting by the legacy `order`
    // field so relative ordering is preserved across the migration.
    const sortedPhrases = [...this.preparedPhrases].sort((a, b) => {
      const ao = a.order ?? 0
      const bo = b.order ?? 0
      return ao - bo
    })
    const stamped = assignOrderKeysInSequence(sortedPhrases)

    let processedCount = 0

    try {
      const db = ctx.db

      await db.transaction(async (tx) => {
        for (const row of stamped) {
          // Regenerate id as uuidv7 so it passes PromptIdSchema on the API boundary;
          // legacy Dexie id is uuidv4 and would be rejected by every :id handler.
          const promptId = uuidv7()

          await tx.insert(promptTable).values({
            id: promptId,
            title: row.title || 'Untitled',
            content: row.content,
            orderKey: row.orderKey,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt
          })

          processedCount++

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
      // The transaction rolled back; no partial rows remain committed.
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

    if (this.prepareError) {
      errors.push({ key: 'prepare_failed', message: this.prepareError })
    }

    try {
      const promptResult = await db.select({ count: sql<number>`count(*)` }).from(promptTable).get()
      const targetCount = promptResult?.count ?? 0

      logger.info('Validation counts', {
        sourceCount: this.promptCount,
        targetPromptCount: targetCount,
        skippedCount: this.skippedCount
      })

      if (targetCount < this.promptCount) {
        errors.push({
          key: 'prompt_count_mismatch',
          expected: this.promptCount,
          actual: targetCount,
          message: `Expected at least ${this.promptCount} prompts, got ${targetCount}`
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
