import { createHash } from 'node:crypto'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { topicProvenanceTable } from '@data/db/schemas/topicProvenance'
import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import type { RegisterLearningSourceInput } from '@data/services/LearningSourceService'
import { learningSourceService } from '@data/services/LearningSourceService'
import { loggerService } from '@logger'
import type { MessageData } from '@shared/data/types/message'
import { asc, eq, gt } from 'drizzle-orm'

export const ENGLISH_LEARNING_IMPORT_BATCH_SIZE = 200
const logger = loggerService.withContext('EnglishLearningImportService')

export interface EnglishLearningImportBatchResult {
  nextCursor?: string
  scanned: number
  registered: number
}

function computeSourceRevision(values: Array<string | null>): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}

export function extractEnglishLearningMessageText(data: MessageData): string {
  return (data.parts ?? [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
    .trim()
}

export class EnglishLearningImportService {
  private get db() {
    return application.get('DbService').getDb()
  }

  registerTranslation(row: typeof translateHistoryTable.$inferSelect): void {
    learningSourceService.register(this.toTranslationInput(row))
  }

  registerTranslationBestEffort(row: typeof translateHistoryTable.$inferSelect): void {
    try {
      this.registerTranslation(row)
    } catch (error) {
      logger.warn('Deferred translation history import until backfill', { historyId: row.id, error })
    }
  }

  registerSelectionRefine(input: { provenanceId: string; selectedText: string; refinedText: string }): void {
    const source = this.toSelectionRefineInput(input)
    if (source) learningSourceService.register(source)
  }

  registerSelectionRefineBestEffort(input: { provenanceId: string; selectedText: string; refinedText: string }): void {
    try {
      this.registerSelectionRefine(input)
    } catch (error) {
      logger.warn('Deferred selection refine import until backfill', {
        provenanceId: input.provenanceId,
        error
      })
    }
  }

  importTranslationBatch(
    cursor?: string,
    limit = ENGLISH_LEARNING_IMPORT_BATCH_SIZE
  ): EnglishLearningImportBatchResult {
    const rows = this.db
      .select()
      .from(translateHistoryTable)
      .where(cursor ? gt(translateHistoryTable.id, cursor) : undefined)
      .orderBy(asc(translateHistoryTable.id))
      .limit(limit)
      .all()
    learningSourceService.registerMany(rows.map((row) => this.toTranslationInput(row)))

    return {
      nextCursor: rows.length === limit ? rows[rows.length - 1].id : undefined,
      scanned: rows.length,
      registered: rows.length
    }
  }

  importSelectionRefineBatch(
    cursor?: string,
    limit = ENGLISH_LEARNING_IMPORT_BATCH_SIZE
  ): EnglishLearningImportBatchResult {
    const rows = this.db
      .select({
        provenance: topicProvenanceTable,
        messageData: messageTable.data
      })
      .from(topicProvenanceTable)
      .innerJoin(messageTable, eq(messageTable.id, topicProvenanceTable.lastMessageId))
      .where(cursor ? gt(topicProvenanceTable.id, cursor) : undefined)
      .orderBy(asc(topicProvenanceTable.id))
      .limit(limit)
      .all()
    const inputs = rows.flatMap(({ provenance, messageData }) => {
      if (provenance.data.kind !== 'selection-action' || provenance.data.actionId !== 'refine') return []
      const input = this.toSelectionRefineInput({
        provenanceId: provenance.id,
        selectedText: provenance.data.selectedText,
        refinedText: extractEnglishLearningMessageText(messageData)
      })
      return input ? [input] : []
    })
    learningSourceService.registerMany(inputs)

    return {
      nextCursor: rows.length === limit ? rows[rows.length - 1].provenance.id : undefined,
      scanned: rows.length,
      registered: inputs.length
    }
  }

  private toTranslationInput(row: typeof translateHistoryTable.$inferSelect): RegisterLearningSourceInput {
    return {
      kind: 'translation',
      sourceRecordId: row.id,
      sourceRevision: computeSourceRevision([row.sourceLanguage, row.targetLanguage, row.sourceText, row.targetText]),
      sourceLanguage: row.sourceLanguage,
      targetLanguage: row.targetLanguage,
      sourceText: row.sourceText,
      targetText: row.targetText
    }
  }

  private toSelectionRefineInput(input: {
    provenanceId: string
    selectedText: string
    refinedText: string
  }): RegisterLearningSourceInput | null {
    const selectedText = input.selectedText.trim()
    const refinedText = input.refinedText.trim()
    if (!selectedText || !refinedText) return null

    return {
      kind: 'selection_refine',
      sourceRecordId: input.provenanceId,
      sourceRevision: computeSourceRevision([selectedText, refinedText]),
      sourceText: selectedText,
      targetText: refinedText
    }
  }
}

export const englishLearningImportService = new EnglishLearningImportService()
