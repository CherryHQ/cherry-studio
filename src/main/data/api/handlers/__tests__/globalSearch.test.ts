import { beforeEach, describe, expect, it, vi } from 'vitest'

const { searchMock } = vi.hoisted(() => ({
  searchMock: vi.fn()
}))

vi.mock('@data/services/GlobalSearchService', () => ({
  globalSearchService: {
    search: searchMock
  }
}))

import { GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE } from '@shared/data/api/schemas/globalSearch'

import { globalSearchHandlers } from '../globalSearch'

describe('globalSearchHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/global-search', () => {
    it('parses query defaults and delegates to GlobalSearchService', async () => {
      const response = { query: 'agent', groups: [], messageItems: [] }
      searchMock.mockResolvedValueOnce(response)

      const result = await globalSearchHandlers['/global-search'].GET({
        query: {
          q: '  agent  '
        }
      } as never)

      expect(searchMock).toHaveBeenCalledWith({
        q: 'agent'
      })
      expect(result).toBe(response)
    })

    it('forwards type, time, and explicit limit filters', async () => {
      searchMock.mockResolvedValueOnce({ query: 'agent', groups: [], messageItems: [] })

      await globalSearchHandlers['/global-search'].GET({
        query: {
          q: 'agent',
          types: ['agent', 'session'],
          updatedAtFrom: '2026-05-01T00:00:00.000Z',
          limitPerType: GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE,
          includeMessages: true
        }
      } as never)

      expect(searchMock).toHaveBeenCalledWith({
        q: 'agent',
        types: ['agent', 'session'],
        updatedAtFrom: '2026-05-01T00:00:00.000Z',
        limitPerType: GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE,
        includeMessages: true
      })
    })

    it('rejects blank q before calling the service', async () => {
      await expect(
        globalSearchHandlers['/global-search'].GET({
          query: {
            q: '   '
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(searchMock).not.toHaveBeenCalled()
    })
  })
})
