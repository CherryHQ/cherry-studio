import { learningSourceTable } from '@data/db/schemas/learningSource'
import { learningSourceService } from '@data/services/LearningSourceService'
import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notifyDataApiDataChange = vi.hoisted(() => vi.fn())

vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange }))

describe('LearningSourceService', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    notifyDataApiDataChange.mockClear()
  })

  const input = {
    kind: 'translation' as const,
    sourceRecordId: 'history-1',
    sourceRevision: 'revision-1',
    sourceLanguage: 'zh-cn',
    targetLanguage: 'en-us',
    sourceText: '你好',
    targetText: 'Hello'
  }

  it('registers one source per kind, record, and revision', () => {
    const first = learningSourceService.register(input)
    const duplicate = learningSourceService.register(input)
    const revised = learningSourceService.register({ ...input, sourceRevision: 'revision-2', targetText: 'Hi' })

    expect(duplicate.id).toBe(first.id)
    expect(revised.id).not.toBe(first.id)
    expect(dbh.db.select().from(learningSourceTable).all()).toHaveLength(2)
    expect(notifyDataApiDataChange).toHaveBeenCalledTimes(2)
  })

  it('filters and cursor-paginates sources', () => {
    learningSourceService.register(input)
    learningSourceService.register({
      ...input,
      sourceRecordId: 'history-2',
      sourceRevision: 'revision-2',
      targetText: 'Good morning'
    })
    const excluded = learningSourceService.register({
      ...input,
      kind: 'selection_refine',
      sourceRecordId: 'provenance-1',
      sourceRevision: 'revision-3'
    })
    learningSourceService.exclude(excluded.id)

    const firstPage = learningSourceService.list({ limit: 1, kind: 'translation' })
    const secondPage = learningSourceService.list({
      limit: 1,
      kind: 'translation',
      cursor: firstPage.nextCursor
    })

    expect(firstPage.items).toHaveLength(1)
    expect(firstPage.total).toBe(2)
    expect(firstPage.nextCursor).toBeDefined()
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.items[0].id).not.toBe(firstPage.items[0].id)
    expect(learningSourceService.list({ limit: 20, status: 'excluded' }).items).toEqual([
      expect.objectContaining({ id: excluded.id })
    ])
  })

  it('only retries failed or excluded sources', () => {
    const source = learningSourceService.register(input)

    expect(() => learningSourceService.retry(source.id)).toThrow()

    learningSourceService.setStatus(source.id, 'failed', 'model failed')
    const retried = learningSourceService.retry(source.id)
    expect(retried.status).toBe('pending')
    expect(retried.error).toBeNull()
  })

  it('excludes idempotently', () => {
    const source = learningSourceService.register(input)
    const excluded = learningSourceService.exclude(source.id)
    notifyDataApiDataChange.mockClear()

    const repeated = learningSourceService.exclude(source.id)

    expect(excluded.status).toBe('excluded')
    expect(repeated).toEqual(excluded)
    expect(notifyDataApiDataChange).not.toHaveBeenCalled()
  })
})
