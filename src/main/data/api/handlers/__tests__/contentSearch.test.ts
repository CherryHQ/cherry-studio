import { beforeEach, describe, expect, it, vi } from 'vitest'

const { searchMock } = vi.hoisted(() => ({
  searchMock: vi.fn()
}))

vi.mock('@data/services/ContentSearchService', () => ({
  contentSearchService: {
    search: searchMock
  }
}))

import { CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE } from '@shared/data/api/schemas/contentSearch'

import { contentSearchHandlers } from '../contentSearch'

describe('contentSearchHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/content-search', () => {
    it('parses query defaults and delegates to ContentSearchService', async () => {
      const response = { query: 'needle', groups: [] }
      searchMock.mockResolvedValueOnce(response)

      const result = await contentSearchHandlers['/content-search'].GET({
        query: {
          q: '  needle  '
        }
      } as never)

      expect(searchMock).toHaveBeenCalledWith({
        q: 'needle'
      })
      expect(result).toBe(response)
    })

    it('forwards sources, source filters, per-source cursors, time, and explicit limit filters', async () => {
      searchMock.mockResolvedValueOnce({ query: 'needle', groups: [] })

      await contentSearchHandlers['/content-search'].GET({
        query: {
          q: 'needle',
          sources: ['topic-message'],
          cursors: { 'topic-message': '200:message-1' },
          filters: { 'topic-message': { topicId: 'topic-1' } },
          createdAtFrom: '2026-05-01T00:00:00.000Z',
          limitPerSource: CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE
        }
      } as never)

      expect(searchMock).toHaveBeenCalledWith({
        q: 'needle',
        sources: ['topic-message'],
        cursors: { 'topic-message': '200:message-1' },
        filters: { 'topic-message': { topicId: 'topic-1' } },
        createdAtFrom: '2026-05-01T00:00:00.000Z',
        limitPerSource: CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE
      })
    })

    it('rejects invalid source and datetime before calling the service', async () => {
      await expect(
        contentSearchHandlers['/content-search'].GET({
          query: {
            q: 'needle',
            sources: ['message']
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      await expect(
        contentSearchHandlers['/content-search'].GET({
          query: {
            q: 'needle',
            createdAtFrom: 'today'
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      await expect(
        contentSearchHandlers['/content-search'].GET({
          query: {
            q: 'needle',
            filters: { 'topic-message': { sessionId: 'session-1' } }
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(searchMock).not.toHaveBeenCalled()
    })
  })
})
