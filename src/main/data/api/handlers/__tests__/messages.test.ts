import { beforeEach, describe, expect, it, vi } from 'vitest'

const { searchMock } = vi.hoisted(() => ({
  searchMock: vi.fn()
}))

vi.mock('@data/services/MessageService', () => ({
  messageService: {
    search: searchMock
  }
}))

import { messageHandlers } from '../messages'

describe('messageHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/messages/search', () => {
    it('forwards normalized topic message search query', async () => {
      const response = { items: [], nextCursor: undefined }
      searchMock.mockResolvedValueOnce(response)

      const result = await messageHandlers['/messages/search'].GET({
        query: {
          q: '  needle  ',
          limit: '10',
          createdAtFrom: '2026-05-01T00:00:00.000Z'
        }
      } as never)

      expect(searchMock).toHaveBeenCalledWith({
        q: 'needle',
        limit: 10,
        createdAtFrom: '2026-05-01T00:00:00.000Z'
      })
      expect(result).toBe(response)
    })
  })
})
