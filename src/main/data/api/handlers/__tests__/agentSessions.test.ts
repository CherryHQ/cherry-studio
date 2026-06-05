import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listSessionMessagesMock, searchSessionMessagesMock, deleteSessionMessageMock } = vi.hoisted(() => ({
  listSessionMessagesMock: vi.fn(),
  searchSessionMessagesMock: vi.fn(),
  deleteSessionMessageMock: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    listByCursor: vi.fn(),
    createSession: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    reorder: vi.fn(),
    reorderBatch: vi.fn()
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: listSessionMessagesMock,
    search: searchSessionMessagesMock,
    deleteSessionMessage: deleteSessionMessageMock
  }
}))

import { agentSessionHandlers } from '../agentSessions'

describe('agentSessionHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/agent-sessions/messages/search', () => {
    it('forwards normalized session message search query', async () => {
      const response = { items: [], nextCursor: undefined }
      searchSessionMessagesMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions/messages/search'].GET({
        query: {
          q: '  needle  ',
          sessionId: 'session-1',
          limit: '10',
          createdAtFrom: '2026-05-01T00:00:00.000Z'
        }
      } as never)

      expect(searchSessionMessagesMock).toHaveBeenCalledWith({
        q: 'needle',
        sessionId: 'session-1',
        limit: 10,
        createdAtFrom: '2026-05-01T00:00:00.000Z'
      })
      expect(result).toBe(response)
    })
  })
})
