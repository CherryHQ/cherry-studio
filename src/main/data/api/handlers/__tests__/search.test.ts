import { beforeEach, describe, expect, it, vi } from 'vitest'

const { contentSearchMock, entitySearchMock } = vi.hoisted(() => ({
  contentSearchMock: vi.fn(),
  entitySearchMock: vi.fn()
}))

vi.mock('@data/services/ContentSearchService', () => ({
  contentSearchService: {
    search: contentSearchMock
  }
}))

vi.mock('@data/services/EntitySearchService', () => ({
  entitySearchService: {
    search: entitySearchMock
  }
}))

import { CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE, ENTITY_SEARCH_MAX_LIMIT_PER_TYPE } from '@shared/data/api/schemas/search'

import { searchHandlers } from '../search'

describe('searchHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/search/entities', () => {
    it('parses query defaults and delegates to EntitySearchService', async () => {
      const response = { query: 'agent', groups: [] }
      entitySearchMock.mockResolvedValueOnce(response)

      const result = await searchHandlers['/search/entities'].GET({
        query: {
          q: '  agent  '
        }
      } as never)

      expect(entitySearchMock).toHaveBeenCalledWith({
        q: 'agent'
      })
      expect(result).toBe(response)
    })

    it('forwards type, time, and explicit limit filters', async () => {
      entitySearchMock.mockResolvedValueOnce({ query: 'agent', groups: [] })

      await searchHandlers['/search/entities'].GET({
        query: {
          q: 'agent',
          types: ['agent', 'session'],
          updatedAtFrom: '2026-05-01T00:00:00.000Z',
          limitPerType: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE
        }
      } as never)

      expect(entitySearchMock).toHaveBeenCalledWith({
        q: 'agent',
        types: ['agent', 'session'],
        updatedAtFrom: '2026-05-01T00:00:00.000Z',
        limitPerType: ENTITY_SEARCH_MAX_LIMIT_PER_TYPE
      })
    })

    it('rejects includeMessages before calling the service', async () => {
      await expect(
        searchHandlers['/search/entities'].GET({
          query: {
            q: 'agent',
            includeMessages: true
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(entitySearchMock).not.toHaveBeenCalled()
    })

    it('rejects blank q before calling the service', async () => {
      await expect(
        searchHandlers['/search/entities'].GET({
          query: {
            q: '   '
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(entitySearchMock).not.toHaveBeenCalled()
    })
  })

  describe('/search/contents', () => {
    it('parses query defaults and delegates to ContentSearchService', async () => {
      const response = { query: 'needle', groups: [] }
      contentSearchMock.mockResolvedValueOnce(response)

      const result = await searchHandlers['/search/contents'].GET({
        query: {
          q: '  needle  '
        }
      } as never)

      expect(contentSearchMock).toHaveBeenCalledWith({
        q: 'needle'
      })
      expect(result).toBe(response)
    })

    it('forwards sources, source filters, per-source cursors, time, and explicit limit filters', async () => {
      contentSearchMock.mockResolvedValueOnce({ query: 'needle', groups: [] })

      await searchHandlers['/search/contents'].GET({
        query: {
          q: 'needle',
          sources: ['topic-message'],
          cursors: { 'topic-message': '200:message-1' },
          filters: { 'topic-message': { topicId: 'topic-1' } },
          createdAtFrom: '2026-05-01T00:00:00.000Z',
          limitPerSource: CONTENT_SEARCH_MAX_LIMIT_PER_SOURCE
        }
      } as never)

      expect(contentSearchMock).toHaveBeenCalledWith({
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
        searchHandlers['/search/contents'].GET({
          query: {
            q: 'needle',
            sources: ['message']
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      await expect(
        searchHandlers['/search/contents'].GET({
          query: {
            q: 'needle',
            createdAtFrom: 'today'
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      await expect(
        searchHandlers['/search/contents'].GET({
          query: {
            q: 'needle',
            filters: { 'topic-message': { sessionId: 'session-1' } }
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      await expect(
        searchHandlers['/search/contents'].GET({
          query: {
            q: 'needle',
            cursors: { 'topic-message': '' }
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(contentSearchMock).not.toHaveBeenCalled()
    })
  })
})
