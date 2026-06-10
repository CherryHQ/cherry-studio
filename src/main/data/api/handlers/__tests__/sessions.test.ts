import { beforeEach, describe, expect, it, vi } from 'vitest'

const { deleteByIdsMock, deleteMock } = vi.hoisted(() => ({
  deleteByIdsMock: vi.fn(),
  deleteMock: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    delete: deleteMock,
    deleteByIds: deleteByIdsMock
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {}
}))

import { agentSessionHandlers } from '../agentSessions'

describe('agentSessionHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/agent-sessions', () => {
    it('delegates selected session delete to AgentSessionService', async () => {
      const response = { deletedIds: ['session-a', 'session-b'], deletedCount: 2 }
      deleteByIdsMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions'].DELETE({
        query: { ids: 'session-a,session-b' }
      } as never)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['session-a', 'session-b'])
      expect(deleteMock).not.toHaveBeenCalled()
      expect(result).toEqual(response)
    })

    it('trims comma-separated session ids before delegating', async () => {
      const response = { deletedIds: ['session-a', 'session-b'], deletedCount: 2 }
      deleteByIdsMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions'].DELETE({
        query: { ids: ' session-a, , session-b ' }
      } as never)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['session-a', 'session-b'])
      expect(result).toEqual(response)
    })

    it('rejects empty selected session ids before calling the service', async () => {
      await expect(
        agentSessionHandlers['/agent-sessions'].DELETE({
          query: { ids: ' , , ' }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(deleteByIdsMock).not.toHaveBeenCalled()
    })
  })
})
