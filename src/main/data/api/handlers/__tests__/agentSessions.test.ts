import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listByCursorMock,
  createSessionMock,
  getByIdMock,
  getLatestActiveMock,
  updateMock,
  setWorkspaceMock,
  reorderMock,
  reorderBatchMock
} = vi.hoisted(() => ({
  listByCursorMock: vi.fn(),
  createSessionMock: vi.fn(),
  getByIdMock: vi.fn(),
  getLatestActiveMock: vi.fn(),
  updateMock: vi.fn(),
  setWorkspaceMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    listByCursor: listByCursorMock,
    create: createSessionMock,
    getById: getByIdMock,
    getLatestActive: getLatestActiveMock,
    update: updateMock,
    setWorkspace: setWorkspaceMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

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

  describe('/agent-sessions/latest', () => {
    it('wraps the latest session from AgentSessionService', async () => {
      const session = { id: 'session-latest' }
      getLatestActiveMock.mockReturnValueOnce(session)

      await expect(agentSessionHandlers['/agent-sessions/latest'].GET({} as never)).resolves.toEqual({ session })
    })

    it('returns { session: null } when there are no sessions', async () => {
      getLatestActiveMock.mockReturnValueOnce(null)

      await expect(agentSessionHandlers['/agent-sessions/latest'].GET({} as never)).resolves.toEqual({ session: null })
    })

    it('narrows the latest lookup to one agent when agentId is given', async () => {
      const session = { id: 'session-agent' }
      getLatestActiveMock.mockReturnValueOnce(session)

      await expect(
        agentSessionHandlers['/agent-sessions/latest'].GET({ query: { agentId: 'agent-1' } } as never)
      ).resolves.toEqual({ session })

      expect(getLatestActiveMock).toHaveBeenCalledWith({ agentId: 'agent-1' })
    })

    it('rejects an empty agentId', async () => {
      await expect(
        agentSessionHandlers['/agent-sessions/latest'].GET({ query: { agentId: '' } } as never)
      ).rejects.toThrow()

      expect(getLatestActiveMock).not.toHaveBeenCalled()
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
})
