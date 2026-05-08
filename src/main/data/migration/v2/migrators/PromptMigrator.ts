/**
 * Prompt migrator - migrates quick phrases from Dexie to SQLite prompt table.
 *
 * Mapping:
 *   QuickPhrase.id        → prompt.id (legacy QuickPhrase.id was uuidv4; preserve it)
 *   QuickPhrase.title     → prompt.title (fallback 'Untitled')
 *   QuickPhrase.content   → prompt.content (${var} syntax preserved)
 *   QuickPhrase.order     → drives relative order; stamped as fractional-indexing `orderKey`
 *   QuickPhrase.createdAt → prompt.createdAt
 *   QuickPhrase.updatedAt → prompt.updatedAt
 */

import { promptTable } from '@data/db/schemas/prompt'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import { PROMPT_CONTENT_MAX } from '@shared/data/types/prompt'
import { sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysInSequence } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('PromptMigrator')

type PromptInsertRow = typeof promptTable.$inferInsert

/** Legacy QuickPhrase shape from Dexie. */
interface LegacyQuickPhrase {
  id?: string
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
  readonly order = 5.5

  private promptCount = 0
  private skippedCount = 0
  private preparedPhrases: LegacyQuickPhrase[] = []

  override reset(): void {
    this.promptCount = 0
    this.skippedCount = 0
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
      this.preparedPhrases = phrases.filter(
        (p) =>
          typeof p.content === 'string' &&
          p.content.length > 0 &&
          p.content.length <= PROMPT_CONTENT_MAX &&
          Number.isFinite(p.createdAt) &&
          Number.isFinite(p.updatedAt)
      )
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

    // Legacy QuickPhraseService.add() gave older rows larger `order` values,
    // so this descending sort reproduces its canonical getAll() order: old → new.
    // PromptService keeps that canonical ascending orderKey; settings UI reverses it for display.
    const sortedPhrases = [...this.preparedPhrases].sort((a, b) => getLegacyOrder(b) - getLegacyOrder(a))
    const stamped = assignOrderKeysInSequence(sortedPhrases)
    const rows: PromptInsertRow[] = []

    try {
      const db = ctx.db

      for (let index = 0; index < stamped.length; index++) {
        const row = stamped[index]
        rows.push({
          id: row.id,
          title: normalizeTitle(row.title),
          content: row.content,
          orderKey: row.orderKey,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        })

        const preparedCount = index + 1
        if (preparedCount % 10 === 0 || preparedCount === this.promptCount) {
          this.reportProgress(
            Math.round((preparedCount / this.promptCount) * 100),
            `Migrated ${preparedCount}/${this.promptCount} prompts`
          )
        }
      }

      await db.transaction(async (tx) => {
        await tx.insert(promptTable).values(rows)
      })

      logger.info('Prompt migration completed', { processedCount: rows.length })
      return { success: true, processedCount: rows.length }
    } catch (error) {
      const err = wrapExecuteError(error, stamped, rows.length)
      logger.error('Execute failed', err)
      // The transaction rolled back; no partial rows remain committed.
      return {
        success: false,
        processedCount: 0,
        error: err.message
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    const errors: ValidationError[] = []
    const db = ctx.db

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

function getLegacyOrder(phrase: LegacyQuickPhrase): number {
  return Number.isFinite(phrase.order) ? (phrase.order as number) : 0
}

function normalizeTitle(title: LegacyQuickPhrase['title']): string {
  return typeof title === 'string' && title.length > 0 ? title : 'Untitled'
}

function wrapExecuteError(
  error: unknown,
  stamped: Array<LegacyQuickPhrase & { orderKey: string }>,
  preparedCount: number
): Error {
  const baseMessage = error instanceof Error ? error.message : String(error)
  const failedBatch = stamped
    .slice(0, Math.min(stamped.length, preparedCount || stamped.length, 5))
    .map((row, index) => `source row ${index} title="${normalizeTitle(row.title)}"`)
    .join('; ')
  return new Error(`Prompt bulk insert failed${failedBatch ? ` (${failedBatch})` : ''}: ${baseMessage}`, {
    cause: error
  })
}
