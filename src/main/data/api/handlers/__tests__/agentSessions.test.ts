import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getConversationByIdMock, getLatestActiveMock, updateMock, setWorkspaceMock, reorderMock, reorderBatchMock } =
  vi.hoisted(() => ({
    getConversationByIdMock: vi.fn(),
    getLatestActiveMock: vi.fn(),
    updateMock: vi.fn(),
    setWorkspaceMock: vi.fn(),
    reorderMock: vi.fn(),
    reorderBatchMock: vi.fn()
  }))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
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
        agentSessionHandlers['/agent-sessions/latest'].GET({ query: { agentId: 'agent-1' } })
      ).resolves.toEqual({ session })

      expect(getLatestActiveMock).toHaveBeenCalledWith({ agentId: 'agent-1' })
    })

    it('rejects an empty agentId', async () => {
      await expect(agentSessionHandlers['/agent-sessions/latest'].GET({ query: { agentId: '' } })).rejects.toThrow()

      expect(getLatestActiveMock).not.toHaveBeenCalled()
    })
  })

  describe('/agent-sessions/:sessionId', () => {
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
