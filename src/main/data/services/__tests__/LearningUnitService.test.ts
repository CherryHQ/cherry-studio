import { learningUnitSourceTable, learningUnitTable } from '@data/db/schemas/learningUnit'
import { learningSourceService } from '@data/services/LearningSourceService'
import {
  computeLearningUnitExactHash,
  learningUnitService,
  normalizeLearningText
} from '@data/services/LearningUnitService'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notifyDataApiDataChange = vi.hoisted(() => vi.fn())

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange }))

describe('LearningUnitService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    notifyDataApiDataChange.mockClear()
  })

  function registerSource(recordId: string) {
    return learningSourceService.register({
      kind: 'translation',
      sourceRecordId: recordId,
      sourceRevision: 'revision-1',
      sourceText: '你好',
      targetText: 'Hello'
    })
  }

  it('normalizes conservatively and hashes English with its meaning', () => {
    expect(normalizeLearningText('  Ｈello   WORLD  ')).toBe('hello world')
    expect(computeLearningUnitExactHash('Hello', '你好')).toBe(computeLearningUnitExactHash(' hello ', ' 你好 '))
    expect(computeLearningUnitExactHash('Hello', '你好')).not.toBe(computeLearningUnitExactHash('Hello', '喂'))
  })

  it('deduplicates exact candidates and preserves all source links', () => {
    const sourceA = registerSource('history-1')
    const sourceB = registerSource('history-2')

    const first = learningUnitService.upsertCandidate({
      sourceId: sourceA.id,
      kind: 'expression',
      english: '  Nice to meet you ',
      meaning: '很高兴认识你',
      tags: ['greeting', ' greeting ', '']
    })
    const duplicate = learningUnitService.upsertCandidate({
      sourceId: sourceB.id,
      kind: 'expression',
      english: 'nice TO meet you',
      meaning: ' 很高兴认识你 '
    })

    expect(duplicate.id).toBe(first.id)
    expect(dbh.db.select().from(learningUnitTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(learningUnitSourceTable).all()).toHaveLength(2)
    expect(first.tags).toEqual(['greeting'])
  })

  it('keeps the same English with different meanings as separate units', () => {
    const source = registerSource('history-1')

    const greeting = learningUnitService.upsertCandidate({
      sourceId: source.id,
      kind: 'expression',
      english: 'Hello',
      meaning: '你好'
    })
    const phoneOpening = learningUnitService.upsertCandidate({
      sourceId: source.id,
      kind: 'expression',
      english: 'Hello',
      meaning: '喂'
    })

    expect(phoneOpening.id).not.toBe(greeting.id)
  })

  it('marks user edits and prevents an exact-hash collision', () => {
    const source = registerSource('history-1')
    const first = learningUnitService.upsertCandidate({
      sourceId: source.id,
      kind: 'expression',
      english: 'See you',
      meaning: '再见'
    })
    const second = learningUnitService.upsertCandidate({
      sourceId: source.id,
      kind: 'expression',
      english: 'Take care',
      meaning: '保重'
    })

    const updated = learningUnitService.update(first.id, {
      english: 'See you later',
      tags: ['farewell', 'farewell'],
      suspended: true
    })
    expect(updated.isUserEdited).toBe(true)
    expect(updated.normalizedEnglish).toBe('see you later')
    expect(updated.tags).toEqual(['farewell'])
    expect(updated.suspended).toBe(true)

    expect(() =>
      learningUnitService.update(second.id, {
        english: updated.english,
        meaning: updated.meaning
      })
    ).toThrow()
  })

  it('searches, filters, and cursor-paginates units', () => {
    const source = registerSource('history-1')
    const phrase = learningUnitService.upsertCandidate({
      sourceId: source.id,
      kind: 'expression',
      english: 'Could you help me?',
      meaning: '你能帮我吗？'
    })
    learningUnitService.upsertCandidate({
      sourceId: source.id,
      kind: 'pattern',
      english: 'Assistance',
      meaning: '帮助'
    })
    learningUnitService.update(phrase.id, { suspended: true })

    const firstPage = learningUnitService.list({ limit: 1 })
    const secondPage = learningUnitService.list({ limit: 1, cursor: firstPage.nextCursor })

    expect(firstPage.total).toBe(2)
    expect(firstPage.nextCursor).toBeDefined()
    expect(secondPage.items).toHaveLength(1)
    expect(learningUnitService.list({ limit: 20, search: 'help' }).items).toHaveLength(1)
    expect(learningUnitService.list({ limit: 20, kind: 'expression', suspended: true }).items).toEqual([
      expect.objectContaining({ id: phrase.id })
    ])
  })

  it('rejects candidates for missing sources', () => {
    expect(() =>
      learningUnitService.upsertCandidate({
        sourceId: 'missing',
        kind: 'expression',
        english: 'Hello',
        meaning: '你好'
      })
    ).toThrow()
  })
})
