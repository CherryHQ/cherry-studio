import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listByCursorMock,
  createSessionMock,
  getByIdMock,
  updateMock,
  deleteMock,
  deleteByAgentIdMock,
  deleteByIdsMock,
  listSessionMessagesMock,
  deleteSessionMessageMock,
  reorderMock,
  reorderBatchMock
} = vi.hoisted(() => ({
  listByCursorMock: vi.fn(),
  createSessionMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  deleteByAgentIdMock: vi.fn(),
  deleteByIdsMock: vi.fn(),
  listSessionMessagesMock: vi.fn(),
  deleteSessionMessageMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    listByCursor: listByCursorMock,
    createSession: createSessionMock,
    getById: getByIdMock,
    update: updateMock,
    delete: deleteMock,
    deleteByAgentId: deleteByAgentIdMock,
    deleteByIds: deleteByIdsMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: listSessionMessagesMock,
    deleteSessionMessage: deleteSessionMessageMock
  }
}))

import { agentSessionHandlers } from '../agentSessions'

describe('agentSessionHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/agent-sessions', () => {
    it('forwards the coerced limit to agentSessionService.listByCursor', async () => {
      const response = { items: [], nextCursor: undefined }
      listByCursorMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions'].GET({
        query: {
          limit: '10'
        }
      } as never)

      expect(listByCursorMock).toHaveBeenCalledWith({
        limit: 10
      })
      expect(result).toBe(response)
    })
  })

  describe('/agents/:agentId/sessions', () => {
    it('delegates agent-scoped session delete to AgentSessionService', async () => {
      const response = { deletedIds: ['session-a'], deletedCount: 1 }
      deleteByAgentIdMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agents/:agentId/sessions'].DELETE({
        params: { agentId: 'agent-1' }
      } as never)

      expect(deleteByAgentIdMock).toHaveBeenCalledWith('agent-1')
      expect(deleteMock).not.toHaveBeenCalled()
      expect(result).toEqual(response)
    })
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
