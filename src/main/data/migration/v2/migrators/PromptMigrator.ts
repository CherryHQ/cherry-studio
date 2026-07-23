/**
 * Prompt migrator - migrates global and assistant quick phrases to the SQLite prompt table.
 *
 * Sources:
 *   Dexie quick_phrases                                 → global prompts
 *   Redux assistants.assistants[].regularPhrases       → global prompts
 *   Redux assistants.presets[].regularPhrases          → global prompts
 *   Redux assistants.defaultAssistant.regularPhrases   → global prompts
 *
 * Mapping:
 *   QuickPhrase.id        → prompt.id (preserve unique UUIDs; regenerate invalid/conflicting IDs)
 *   QuickPhrase.title     → prompt.title (trim; fallback 'Untitled'; clamp to the v2 limit)
 *   QuickPhrase.content   → prompt.content (${var} syntax preserved)
 *   QuickPhrase.order     → drives global relative order; stamped as fractional-indexing `orderKey`
 *   QuickPhrase timestamps → prompt timestamps (preserve valid date values; repair missing/invalid values)
 */

import { promptTable } from '@data/db/schemas/prompt'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult, ValidationError } from '@shared/data/migration/v2/types'
import {
  PROMPT_CONTENT_MAX,
  PROMPT_TITLE_MAX,
  PromptContentSchema,
  PromptIdSchema,
  PromptSchema,
  PromptTitleSchema
} from '@shared/data/types/prompt'
import { sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import type { MigrationContext } from '../core/MigrationContext'
import { assignOrderKeysInSequence } from '../utils/orderKey'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('PromptMigrator')
const INSERT_BATCH_SIZE = 100
const INVALID_SOURCE_PREVIEW_LIMIT = 5

type PromptInsertRow = typeof promptTable.$inferInsert

interface PreparedPhrase {
  id: string
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

interface NormalizedLegacyPhrase {
  legacyId?: string
  phrase: Omit<PreparedPhrase, 'id'>
  normalizedTitle: boolean
  normalizedTimestamps: boolean
}

interface LegacyAssistantState {
  assistants?: unknown
  presets?: unknown
  defaultAssistant?: unknown
}

interface LegacyPhraseCandidate {
  phrase: unknown
  source: string
  invalidReason?: string
}

interface InvalidPhraseDetail {
  source: string
  reason: string
}

export class PromptMigrator extends BaseMigrator {
  readonly id = 'prompt'
  readonly name = 'Prompts'
  readonly description = 'Migrate quick phrases to prompts'
  readonly order = 5.5

  private sourceCount = 0
  private promptCount = 0
  private skippedCount = 0
  private preparedPhrases: PreparedPhrase[] = []

  override reset(): void {
    this.sourceCount = 0
    this.promptCount = 0
    this.skippedCount = 0
    this.preparedPhrases = []
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const exists = await ctx.sources.dexieExport.tableExists('quick_phrases')
      let globalPhrases: unknown[] = []
      if (exists) {
        globalPhrases = await ctx.sources.dexieExport.readTable<unknown>('quick_phrases')
      } else {
        logger.info('quick_phrases table not found, skipping')
      }

      // Keep the existing global prompt order stable. Assistant arrays already use
      // canonical old → new order, so append them without sorting across scopes.
      const orderedGlobalPhrases = globalPhrases
        .map((phrase, index) => ({ phrase, source: `quick_phrases[${index}]` }))
        .sort((a, b) => getLegacyOrder(b.phrase) - getLegacyOrder(a.phrase))
      const assistantState = ctx.sources.reduxState.getCategory<LegacyAssistantState>('assistants')
      const candidates: LegacyPhraseCandidate[] = [
        ...orderedGlobalPhrases,
        ...collectAssistantPhraseCandidates(assistantState)
      ]

      this.sourceCount = candidates.length
      this.preparedPhrases = []

      const fallbackTimestamp = Date.now()
      const reservedIds = collectReservedPromptIds(candidates)
      const variantsByLegacyId = new Map<string, Set<string>>()
      const usedIds = new Set<string>()
      let invalidCount = 0
      let duplicateCount = 0
      let reassignedIdCount = 0
      let regeneratedIdCount = 0
      let normalizedTitleCount = 0
      let normalizedTimestampCount = 0
      const invalidDetails: InvalidPhraseDetail[] = []

      for (const candidate of candidates) {
        const normalized = candidate.invalidReason
          ? ({ success: false, reason: candidate.invalidReason } as const)
          : normalizeLegacyPhrase(candidate.phrase, fallbackTimestamp)
        if (!normalized.success) {
          invalidCount++
          appendInvalidDetail(invalidDetails, candidate.source, normalized.reason)
          continue
        }

        const { legacyId, phrase } = normalized.value
        const fingerprint = JSON.stringify([phrase.title, phrase.content])
        let id: string

        if (legacyId) {
          const existingVariants = variantsByLegacyId.get(legacyId)

          if (existingVariants?.has(fingerprint)) {
            duplicateCount++
            continue
          }

          const parsedId = PromptIdSchema.safeParse(legacyId)
          if (parsedId.success && !existingVariants && !usedIds.has(parsedId.data)) {
            id = parsedId.data
          } else {
            id = generateUniqueId(usedIds, reservedIds)
            if (parsedId.success) {
              reassignedIdCount++
              logger.warn('Reassigned conflicting quick phrase id', {
                legacyId,
                reassignedId: id,
                source: candidate.source
              })
            } else {
              regeneratedIdCount++
              logger.warn('Regenerated invalid quick phrase id', {
                legacyId,
                regeneratedId: id,
                source: candidate.source
              })
            }
          }

          const variants = existingVariants ?? new Set<string>()
          variants.add(fingerprint)
          variantsByLegacyId.set(legacyId, variants)
        } else {
          id = generateUniqueId(usedIds, reservedIds)
          regeneratedIdCount++
          logger.warn('Generated missing quick phrase id', { regeneratedId: id, source: candidate.source })
        }

        usedIds.add(id)
        if (normalized.value.normalizedTitle) normalizedTitleCount++
        if (normalized.value.normalizedTimestamps) normalizedTimestampCount++
        this.preparedPhrases.push({ id, ...phrase })
      }

      this.skippedCount = invalidCount + duplicateCount
      this.promptCount = this.preparedPhrases.length

      if (invalidCount > 0) {
        logger.warn('Skipped invalid quick phrases', { skipped: invalidCount, sources: invalidDetails })
      }
      if (duplicateCount > 0) {
        logger.info('Skipped duplicate quick phrases', { skipped: duplicateCount })
      }

      logger.info('Prepared prompt migration', {
        sourceCount: this.sourceCount,
        count: this.promptCount,
        skipped: this.skippedCount,
        reassignedIds: reassignedIdCount,
        regeneratedIds: regeneratedIdCount,
        normalizedTitles: normalizedTitleCount,
        repairedTimestamps: normalizedTimestampCount
      })

      return {
        success: true,
        itemCount: this.promptCount
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

    const stamped = assignOrderKeysInSequence(this.preparedPhrases)
    const rows: PromptInsertRow[] = []

    try {
      const db = ctx.db

      for (let index = 0; index < stamped.length; index++) {
        const row = stamped[index]
        const insertRow: PromptInsertRow = {
          id: row.id,
          title: row.title,
          content: row.content,
          orderKey: row.orderKey,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }
        assertPromptInsertRow(insertRow)
        rows.push(insertRow)

        const preparedCount = index + 1
        if (preparedCount % 10 === 0 || preparedCount === this.promptCount) {
          this.reportProgress(
            Math.round((preparedCount / this.promptCount) * 100),
            `Migrated ${preparedCount}/${this.promptCount} prompts`
          )
        }
      }

      db.transaction((tx) => {
        for (let start = 0; start < rows.length; start += INSERT_BATCH_SIZE) {
          tx.insert(promptTable)
            .values(rows.slice(start, start + INSERT_BATCH_SIZE))
            .run()
        }
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
      const promptResult = db.select({ count: sql<number>`count(*)` }).from(promptTable).get()
      const targetCount = promptResult?.count ?? 0

      logger.info('Validation counts', {
        sourceCount: this.sourceCount,
        targetPromptCount: targetCount,
        skippedCount: this.skippedCount
      })

      if (targetCount !== this.promptCount) {
        errors.push({
          key: 'prompt_count_mismatch',
          expected: this.promptCount,
          actual: targetCount,
          message: `Expected ${this.promptCount} prompts, got ${targetCount}`
        })
      }

      const targetRows = db.select().from(promptTable).all()
      const invalidTargetRows = targetRows.filter((row) => getPromptContractErrors(row).length > 0)
      if (invalidTargetRows.length > 0) {
        errors.push({
          key: 'prompt_contract_mismatch',
          expected: 0,
          actual: invalidTargetRows.length,
          message: `${invalidTargetRows.length} migrated prompts violate the v2 prompt contract`
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
      logger.error('Validation failed', error as Error)
      errors.push({
        key: 'validation_error',
        message: error instanceof Error ? error.message : String(error)
      })
      return {
        success: false,
        errors,
        stats: {
          sourceCount: this.sourceCount,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}

function getLegacyOrder(phrase: unknown): number {
  if (!isRecord(phrase)) return 0
  return typeof phrase.order === 'number' && Number.isFinite(phrase.order) ? phrase.order : 0
}

function collectAssistantPhraseCandidates(state: LegacyAssistantState | undefined): LegacyPhraseCandidate[] {
  if (!state) return []

  const candidates: LegacyPhraseCandidate[] = []
  const appendAssistant = (assistant: unknown, source: string): void => {
    if (!isRecord(assistant) || !Object.hasOwn(assistant, 'regularPhrases') || assistant.regularPhrases === undefined) {
      return
    }

    if (!Array.isArray(assistant.regularPhrases)) {
      candidates.push({
        phrase: assistant.regularPhrases,
        source: `${source}.regularPhrases`,
        invalidReason: 'regularPhrases is not an array'
      })
      return
    }

    assistant.regularPhrases.forEach((phrase, index) => {
      candidates.push({ phrase, source: `${source}.regularPhrases[${index}]` })
    })
  }

  if (Array.isArray(state.assistants)) {
    state.assistants.forEach((assistant, index) => appendAssistant(assistant, `assistants[${index}]`))
  }
  if (Array.isArray(state.presets)) {
    state.presets.forEach((assistant, index) => appendAssistant(assistant, `presets[${index}]`))
  }
  appendAssistant(state.defaultAssistant, 'defaultAssistant')

  return candidates
}

function normalizeLegacyPhrase(
  phrase: unknown,
  fallbackTimestamp: number
): { success: true; value: NormalizedLegacyPhrase } | { success: false; reason: string } {
  if (!isRecord(phrase)) return { success: false, reason: 'entry is not an object' }

  const contentResult = PromptContentSchema.safeParse(phrase.content)
  if (!contentResult.success) {
    const reason =
      typeof phrase.content !== 'string'
        ? 'content is not a string'
        : phrase.content.length === 0
          ? 'content is empty'
          : phrase.content.length > PROMPT_CONTENT_MAX
            ? `content exceeds ${PROMPT_CONTENT_MAX} characters`
            : 'content violates the v2 prompt contract'
    return { success: false, reason }
  }

  const title = normalizeTitle(phrase.title)
  const sourceCreatedAt = validTimestamp(phrase.createdAt)
  const sourceUpdatedAt = validTimestamp(phrase.updatedAt)
  const createdAt = sourceCreatedAt ?? sourceUpdatedAt ?? fallbackTimestamp
  const updatedAt = sourceUpdatedAt ?? createdAt

  return {
    success: true,
    value: {
      legacyId: typeof phrase.id === 'string' && phrase.id.length > 0 ? phrase.id : undefined,
      phrase: {
        title,
        content: contentResult.data,
        createdAt,
        updatedAt
      },
      normalizedTitle: title !== phrase.title,
      normalizedTimestamps: sourceCreatedAt === undefined || sourceUpdatedAt === undefined
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  return PromptSchema.shape.createdAt.safeParse(date.toISOString()).success ? value : undefined
}

function collectReservedPromptIds(candidates: LegacyPhraseCandidate[]): Set<string> {
  const ids = new Set<string>()
  for (const candidate of candidates) {
    if (candidate.invalidReason) continue
    if (!isRecord(candidate.phrase)) continue
    const parsedId = PromptIdSchema.safeParse(candidate.phrase.id)
    if (parsedId.success) ids.add(parsedId.data)
  }
  return ids
}

function generateUniqueId(usedIds: ReadonlySet<string>, reservedIds: ReadonlySet<string>): string {
  let id = uuidv4()
  while (usedIds.has(id) || reservedIds.has(id)) {
    id = uuidv4()
  }
  return id
}

function normalizeTitle(title: unknown): string {
  const trimmed = typeof title === 'string' ? title.trim() : ''
  const bounded = truncateAtCodePointBoundary(trimmed || 'Untitled', PROMPT_TITLE_MAX)
  return PromptTitleSchema.parse(bounded)
}

function truncateAtCodePointBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value

  const bounded = value.slice(0, maxLength)
  const lastCodeUnit = bounded.charCodeAt(bounded.length - 1)
  const nextCodeUnit = value.charCodeAt(bounded.length)
  const splitsSurrogatePair =
    lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff
  return splitsSurrogatePair ? bounded.slice(0, -1) : bounded
}

function appendInvalidDetail(details: InvalidPhraseDetail[], source: string, reason: string): void {
  if (details.length < INVALID_SOURCE_PREVIEW_LIMIT) details.push({ source, reason })
}

function getPromptContractErrors(row: {
  id?: unknown
  title?: unknown
  content?: unknown
  orderKey?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}): string[] {
  const errors: string[] = []
  if (!PromptIdSchema.safeParse(row.id).success) errors.push('id')

  const titleResult = PromptTitleSchema.safeParse(row.title)
  if (!titleResult.success || titleResult.data !== row.title) errors.push('title')
  if (!PromptContentSchema.safeParse(row.content).success) errors.push('content')
  if (typeof row.orderKey !== 'string' || row.orderKey.length === 0) errors.push('orderKey')
  if (validTimestamp(row.createdAt) === undefined) errors.push('createdAt')
  if (validTimestamp(row.updatedAt) === undefined) errors.push('updatedAt')
  return errors
}

function assertPromptInsertRow(row: PromptInsertRow): void {
  const errors = getPromptContractErrors(row)
  if (errors.length > 0) {
    throw new Error(`Prepared prompt violates the v2 prompt contract: ${errors.join(', ')}`)
  }
}

function wrapExecuteError(
  error: unknown,
  stamped: Array<PreparedPhrase & { orderKey: string }>,
  preparedCount: number
): Error {
  const baseMessage = error instanceof Error ? error.message : String(error)
  const failedBatch = stamped
    .slice(0, Math.min(stamped.length, preparedCount || stamped.length, 5))
    .map((row, index) => `source row ${index} title="${row.title}"`)
    .join('; ')
  return new Error(`Prompt bulk insert failed${failedBatch ? ` (${failedBatch})` : ''}: ${baseMessage}`, {
    cause: error
  })
}
