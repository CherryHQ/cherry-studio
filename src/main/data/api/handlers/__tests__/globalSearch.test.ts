import { beforeEach, describe, expect, it, vi } from 'vitest'

const { searchMock } = vi.hoisted(() => ({
  searchMock: vi.fn()
}))

vi.mock('@data/services/GlobalSearchService', () => ({
  globalSearchService: {
    search: searchMock
  }
}))

import {
  GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE,
  GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE
} from '@shared/data/api/schemas/globalSearch'

import { globalSearchHandlers } from '../globalSearch'

describe('globalSearchHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/global-search', () => {
    it('parses query defaults and delegates to GlobalSearchService', async () => {
      const response = { query: 'agent', groups: [] }
      searchMock.mockResolvedValueOnce(response)

      const result = await globalSearchHandlers['/global-search'].GET({
        query: {
          q: '  agent  '
        }
      } as never)

      expect(searchMock).toHaveBeenCalledWith({
        q: 'agent',
        limitPerType: GLOBAL_SEARCH_DEFAULT_LIMIT_PER_TYPE
      })
      expect(result).toBe(response)
    })

    it('forwards type filters and explicit limitPerType', async () => {
      searchMock.mockResolvedValueOnce({ query: 'agent', groups: [] })

      await globalSearchHandlers['/global-search'].GET({
        query: {
          q: 'agent',
          types: ['agent', 'session'],
          limitPerType: GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE
        }
      } as never)

      expect(searchMock).toHaveBeenCalledWith({
        q: 'agent',
        types: ['agent', 'session'],
        limitPerType: GLOBAL_SEARCH_MAX_LIMIT_PER_TYPE
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
