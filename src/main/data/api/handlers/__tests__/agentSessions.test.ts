import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listByCursorMock,
  createSessionMock,
  getByIdMock,
  getConversationByIdMock,
  getLatestActiveMock,
  updateMock,
  setWorkspaceMock,
  reorderMock,
  reorderBatchMock
} = vi.hoisted(() => ({
  listByCursorMock: vi.fn(),
  createSessionMock: vi.fn(),
  getByIdMock: vi.fn(),
  getConversationByIdMock: vi.fn(),
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
    getConversationById: getConversationByIdMock,
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
    // `getConversationById` is synchronous; scope violations throw inline.
    getConversationByIdMock.mockReturnValue({ id: 'session-1' })
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

      await expect(agentSessionHandlers['/agent-sessions/latest'].GET({})).resolves.toEqual({ session })
    })

    it('returns { session: null } when there are no sessions', async () => {
      getLatestActiveMock.mockReturnValueOnce(null)

      await expect(agentSessionHandlers['/agent-sessions/latest'].GET({})).resolves.toEqual({ session: null })
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
    it('reads through the conversation scope so background sessions 404 by id', async () => {
      const session = { id: 'session-1' }
      getConversationByIdMock.mockResolvedValueOnce(session)

      await expect(
        agentSessionHandlers['/agent-sessions/:sessionId'].GET({ params: { sessionId: 'session-1' } })
      ).resolves.toBe(session)

      expect(getConversationByIdMock).toHaveBeenCalledWith('session-1')
      expect(getByIdMock).not.toHaveBeenCalled()
    })

    it('forwards manual-name marker updates to AgentSessionService', async () => {
      const response = { id: 'session-1', name: 'Renamed session', isNameManuallyEdited: true }
      updateMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions/:sessionId'].PATCH({
        params: { sessionId: 'session-1' },
        body: {
          name: 'Renamed session',
          isNameManuallyEdited: true
        }
      })

      expect(getConversationByIdMock).toHaveBeenCalledWith('session-1')
      expect(updateMock).toHaveBeenCalledWith('session-1', {
        name: 'Renamed session',
        isNameManuallyEdited: true
      })
      expect(result).toBe(response)
    })

    it('rejects a mutation for a session outside the conversation scope before touching it', async () => {
      getConversationByIdMock.mockImplementationOnce(() => {
        throw new Error('not found')
      })

      await expect(
        agentSessionHandlers['/agent-sessions/:sessionId'].PATCH({
          params: { sessionId: 'session-bg' },
          body: { name: 'Renamed' }
        })
      ).rejects.toThrow('not found')

      expect(updateMock).not.toHaveBeenCalled()
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

      expect(getConversationByIdMock).toHaveBeenCalledWith('session-1')
      expect(setWorkspaceMock).toHaveBeenCalledWith('session-1', {
        type: 'user',
        workspaceId: 'workspace-1'
      })
      expect(result).toBe(response)
    })

    it('rejects an out-of-scope session before validating the body', async () => {
      getConversationByIdMock.mockImplementationOnce(() => {
        throw new Error('not found')
      })

      await expect(
        agentSessionHandlers['/agent-sessions/:sessionId/workspace'].PUT({
          params: { sessionId: 'session-bg' },
          body: { type: 'nonsense' }
        } as never)
      ).rejects.toThrow('not found')

      expect(setWorkspaceMock).not.toHaveBeenCalled()
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

  describe('/agent-sessions/:id/order', () => {
    it('scopes the session, then forwards the parsed anchor to reorder', async () => {
      await agentSessionHandlers['/agent-sessions/:id/order'].PATCH({
        params: { id: 'session-1' },
        body: { after: 'session-2' }
      })

      expect(getConversationByIdMock).toHaveBeenCalledWith('session-1')
      expect(reorderMock).toHaveBeenCalledWith('session-1', { after: 'session-2' })
    })

    it('rejects an out-of-scope session before reordering', async () => {
      getConversationByIdMock.mockImplementationOnce(() => {
        throw new Error('not found')
      })

      await expect(
        agentSessionHandlers['/agent-sessions/:id/order'].PATCH({
          params: { id: 'session-bg' },
          body: { after: 'session-2' }
        })
      ).rejects.toThrow('not found')

      expect(reorderMock).not.toHaveBeenCalled()
    })
  })

  describe('/agent-sessions/order:batch', () => {
    it('scopes every moved session, then forwards the moves to reorderBatch', async () => {
      const moves = [
        { id: 'session-1', anchor: { after: 'session-2' } },
        { id: 'session-3', anchor: { before: 'session-2' } }
      ]

      await agentSessionHandlers['/agent-sessions/order:batch'].PATCH({ body: { moves } })

      expect(getConversationByIdMock).toHaveBeenCalledTimes(2)
      expect(getConversationByIdMock).toHaveBeenNthCalledWith(1, 'session-1')
      expect(getConversationByIdMock).toHaveBeenNthCalledWith(2, 'session-3')
      expect(reorderBatchMock).toHaveBeenCalledWith(moves)
    })

    it('rejects when any moved session is out of scope and reorders nothing', async () => {
      getConversationByIdMock.mockImplementationOnce(() => {
        throw new Error('not found')
      })

      await expect(
        agentSessionHandlers['/agent-sessions/order:batch'].PATCH({
          body: {
            moves: [
              { id: 'session-1', anchor: { after: 'session-2' } },
              { id: 'session-bg', anchor: { after: 'session-2' } }
            ]
          }
        })
      ).rejects.toThrow('not found')

      expect(reorderBatchMock).not.toHaveBeenCalled()
    })
  })
})
