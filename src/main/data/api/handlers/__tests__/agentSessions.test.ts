import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listByCursorMock,
  createSessionMock,
  getByIdMock,
  updateMock,
  setWorkspaceMock,
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
  setWorkspaceMock: vi.fn(),
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
    create: createSessionMock,
    getById: getByIdMock,
    update: updateMock,
    setWorkspace: setWorkspaceMock,
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

import { AGENT_SESSION_DELETE_MAX_IDS } from '@shared/data/api/schemas/agentSessions'

import { agentSessionHandlers } from '../agentSessions'

describe('agentSessionHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/agent-sessions', () => {
    it('forwards query to agentSessionService.listByCursor', async () => {
      const response = { items: [], nextCursor: undefined }
      listByCursorMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions'].GET({
        query: {
          agentId: 'agent-1',
          limit: '10'
        }
      } as never)

      expect(listByCursorMock).toHaveBeenCalledWith({
        agentId: 'agent-1',
        limit: 10
      })
      expect(result).toBe(response)
    })
  })

  describe('/agent-sessions/:sessionId', () => {
    it('forwards manual-name marker updates to AgentSessionService', async () => {
      const response = { id: 'session-1', name: 'Renamed session', isNameManuallyEdited: true }
      updateMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions/:sessionId'].PATCH({
        params: { sessionId: 'session-1' },
        body: {
          name: 'Renamed session',
          isNameManuallyEdited: true
        }
      } as never)

      expect(updateMock).toHaveBeenCalledWith('session-1', {
        name: 'Renamed session',
        isNameManuallyEdited: true
      })
      expect(result).toBe(response)
    })
  })

  describe('/agent-sessions/:sessionId/workspace', () => {
    it('forwards parsed workspace body to AgentSessionService', async () => {
      const response = { id: 'session-1', workspaceId: 'workspace-1' }
      setWorkspaceMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions/:sessionId/workspace'].PUT({
        params: { sessionId: 'session-1' },
        body: {
          type: 'user',
          workspaceId: 'workspace-1'
        }
      } as never)

      expect(setWorkspaceMock).toHaveBeenCalledWith('session-1', {
        type: 'user',
        workspaceId: 'workspace-1'
      })
      expect(result).toBe(response)
    })

    it('rejects invalid workspace body before calling the service', async () => {
      await expect(
        agentSessionHandlers['/agent-sessions/:sessionId/workspace'].PUT({
          params: { sessionId: 'session-1' },
          body: {
            type: 'user'
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(setWorkspaceMock).not.toHaveBeenCalled()
    })
  })

  describe('/agents/:agentId/sessions', () => {
    it('delegates agent-scoped session delete to AgentSessionService', async () => {
      const response = { deletedIds: ['session-a'] }
      deleteByAgentIdMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agents/:agentId/sessions'].DELETE({
        params: { agentId: 'agent-1' }
      } as never)

      expect(deleteByAgentIdMock).toHaveBeenCalledWith('agent-1')
      expect(deleteMock).not.toHaveBeenCalled()
      expect(result).toEqual(response)
    })

    it('rejects invalid agent id before calling the service', async () => {
      await expect(
        agentSessionHandlers['/agents/:agentId/sessions'].DELETE({
          params: { agentId: '' }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(deleteByAgentIdMock).not.toHaveBeenCalled()
    })
  })

  describe('/agent-sessions', () => {
    it('delegates selected session delete to AgentSessionService', async () => {
      const response = { deletedIds: ['session-a', 'session-b'] }
      deleteByIdsMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions'].DELETE({
        query: { ids: 'session-a,session-b' }
      } as never)

      expect(deleteByIdsMock).toHaveBeenCalledWith(['session-a', 'session-b'])
      expect(deleteMock).not.toHaveBeenCalled()
      expect(result).toEqual(response)
    })

    it('trims comma-separated session ids before delegating', async () => {
      const response = { deletedIds: ['session-a', 'session-b'] }
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

    it('rejects too many selected session ids before calling the service', async () => {
      const ids = Array.from({ length: AGENT_SESSION_DELETE_MAX_IDS + 1 }, (_, index) => `session-${index}`).join(',')

      await expect(
        agentSessionHandlers['/agent-sessions'].DELETE({
          query: { ids }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(deleteByIdsMock).not.toHaveBeenCalled()
    })
  })

  describe('/agent-sessions/:sessionId/messages', () => {
    it('forwards messageId query to agentSessionMessageService.listSessionMessages', async () => {
      const response = { items: [], nextCursor: undefined }
      listSessionMessagesMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions/:sessionId/messages'].GET({
        params: { sessionId: 'session-1' },
        query: {
          messageId: 'message-1',
          limit: '25'
        }
      } as never)

      expect(listSessionMessagesMock).toHaveBeenCalledWith('session-1', {
        messageId: 'message-1',
        limit: 25
      })
      expect(result).toBe(response)
    })
  })
})
