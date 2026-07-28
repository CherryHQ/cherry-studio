import { learningSourceTable } from '@data/db/schemas/learningSource'
import { translateHistoryTable } from '@data/db/schemas/translateHistory'
import { englishLearningImportService } from '@data/services/EnglishLearningImportService'
import { TemporaryChatService } from '@data/services/TemporaryChatService'
import type { MessageData } from '@shared/data/types/message'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: vi.fn() }))

function text(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] }
}

describe('EnglishLearningImportService', () => {
  const dbh = setupTestDatabase()

  it('backfills every translation revision idempotently in bounded batches', () => {
    dbh.db
      .insert(translateHistoryTable)
      .values([
        {
          id: '00000000-0000-4000-8000-000000000001',
          sourceText: '你好',
          targetText: 'Hello'
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          sourceText: '谢谢',
          targetText: 'Thank you'
        }
      ])
      .run()

    const first = englishLearningImportService.importTranslationBatch(undefined, 1)
    const second = englishLearningImportService.importTranslationBatch(first.nextCursor, 1)
    englishLearningImportService.importTranslationBatch(undefined, 10)

    expect(first).toMatchObject({ scanned: 1, registered: 1 })
    expect(first.nextCursor).toBeDefined()
    expect(second).toMatchObject({ scanned: 1, registered: 1 })
    expect(dbh.db.select().from(learningSourceTable).all()).toHaveLength(2)
  })

  it('backfills only refine provenance and reads the final assistant text', () => {
    const temporaryChatService = new TemporaryChatService()
    const refineTopic = temporaryChatService.createTopic({ name: 'Refine' })
    temporaryChatService.appendMessage(refineTopic.id, { role: 'user', data: text('Improve this') })
    temporaryChatService.appendMessage(refineTopic.id, { role: 'assistant', data: text('A polished sentence.') })
    temporaryChatService.persist(refineTopic.id, {
      provenance: { kind: 'selection-action', actionId: 'refine', selectedText: 'rough sentence' }
    })

    const translateTopic = temporaryChatService.createTopic({ name: 'Translate' })
    temporaryChatService.appendMessage(translateTopic.id, { role: 'user', data: text('Translate this') })
    temporaryChatService.appendMessage(translateTopic.id, { role: 'assistant', data: text('翻译结果') })
    temporaryChatService.persist(translateTopic.id, {
      provenance: { kind: 'selection-action', actionId: 'translate', selectedText: 'Translate this' }
    })

    expect(dbh.db.select().from(learningSourceTable).all()).toHaveLength(1)
    dbh.db.delete(learningSourceTable).run()
    const result = englishLearningImportService.importSelectionRefineBatch()
    const rows = dbh.db.select().from(learningSourceTable).all()

    expect(result).toMatchObject({ scanned: 2, registered: 1 })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'selection_refine',
      sourceText: 'rough sentence',
      targetText: 'A polished sentence.'
    })
  })

  it('creates a new source revision only when translation content changes', () => {
    const original = {
      id: '00000000-0000-4000-8000-000000000001',
      sourceText: '你好',
      targetText: 'Hello',
      sourceLanguage: null,
      targetLanguage: null,
      star: false,
      createdAt: 1,
      updatedAt: 1
    }

    englishLearningImportService.registerTranslation(original)
    englishLearningImportService.registerTranslation({ ...original, star: true, updatedAt: 2 })
    englishLearningImportService.registerTranslation({ ...original, targetText: 'Hi', updatedAt: 3 })

    expect(dbh.db.select().from(learningSourceTable).all()).toHaveLength(2)
  })
})
