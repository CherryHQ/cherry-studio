import { createHash } from 'node:crypto'

import { application } from '@application'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
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

  registerSelectionAction(input: {
    provenanceId: string
    actionId: string
    actionName?: string
    selectedText: string
    outputText: string
  }): void {
    const source = this.toSelectionActionInput({ ...input, sourceRecordId: input.provenanceId })
    if (source) learningSourceService.register(source)
  }

  registerSelectionActionResult(input: {
    actionId: string
    actionName?: string
    selectedText: string
    outputText: string
  }): void {
    const sourceRevision = computeSourceRevision([input.actionId, input.selectedText.trim(), input.outputText.trim()])
    const source = this.toSelectionActionInput({
      ...input,
      sourceRecordId: `selection-action:${input.actionId}:${sourceRevision}`
    })
    if (source) learningSourceService.register(source)
  }

  registerSelectionActionBestEffort(input: {
    provenanceId: string
    actionId: string
    actionName?: string
    selectedText: string
    outputText: string
  }): void {
    try {
      this.registerSelectionAction(input)
    } catch (error) {
      logger.warn('Deferred selection action import until backfill', {
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

  importSelectionActionBatch(
    cursor?: string,
    limit = ENGLISH_LEARNING_IMPORT_BATCH_SIZE
  ): EnglishLearningImportBatchResult {
    const rows = this.db
      .select({
        provenance: topicProvenanceTable,
        topicName: topicTable.name,
        messageData: messageTable.data
      })
      .from(topicProvenanceTable)
      .innerJoin(topicTable, eq(topicTable.id, topicProvenanceTable.topicId))
      .innerJoin(messageTable, eq(messageTable.id, topicProvenanceTable.lastMessageId))
      .where(cursor ? gt(topicProvenanceTable.id, cursor) : undefined)
      .orderBy(asc(topicProvenanceTable.id))
      .limit(limit)
      .all()
    const inputs = rows.flatMap(({ provenance, topicName, messageData }) => {
      if (provenance.data.kind !== 'selection-action') return []
      const input = this.toSelectionActionInput({
        sourceRecordId: provenance.id,
        actionId: provenance.data.actionId,
        actionName: provenance.data.actionName ?? topicName,
        selectedText: provenance.data.selectedText,
        outputText: extractEnglishLearningMessageText(messageData)
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

  private toSelectionActionInput(input: {
    sourceRecordId: string
    actionId: string
    actionName?: string
    selectedText: string
    outputText: string
  }): RegisterLearningSourceInput | null {
    const selectedText = input.selectedText.trim()
    const outputText = input.outputText.trim()
    if (!selectedText || !outputText) return null
    const kind = classifySelectionActionKind({
      actionId: input.actionId,
      actionName: input.actionName,
      selectedText,
      outputText
    })

    return {
      kind,
      sourceRecordId: input.sourceRecordId,
      sourceRevision: computeSourceRevision([input.actionId, selectedText, outputText]),
      sourceText: selectedText,
      targetText: outputText
    }
  }
}

export const englishLearningImportService = new EnglishLearningImportService()

export function classifySelectionActionKind(input: {
  actionId: string
  actionName?: string
  selectedText: string
  outputText: string
}): RegisterLearningSourceInput['kind'] {
  const actionLabel = `${input.actionId} ${input.actionName ?? ''}`.normalize('NFKC').toLowerCase()
  if (/\b(refine|polish|rewrite|proofread|grammar|improve)\b|润色|改写|优化|校对|纠错|语法/.test(actionLabel)) {
    return 'selection_refine'
  }
  return 'selection_action'
}
