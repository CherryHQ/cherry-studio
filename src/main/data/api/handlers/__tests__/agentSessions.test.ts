import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getConversationByIdMock,
  getLatestActiveMock,
  updateMock,
  setWorkspaceMock,
  reorderMock,
  reorderBatchMock,
  createMock,
  getAgentMock,
  trackProductEventMock
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  getAgentMock: vi.fn(),
  trackProductEventMock: vi.fn(),
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
    reorderBatch: reorderBatchMock,
    create: createMock
  }
}))
vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: getAgentMock } }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AnalyticsService: { trackProductEvent: trackProductEventMock } } as never)
})

import { agentSessionHandlers } from '../agentSessions'

describe('agentSessionHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // `getConversationById` is synchronous; scope violations throw inline.
    getConversationByIdMock.mockReturnValue({ id: 'session-1' })
  })

  describe('/agent-sessions POST', () => {
    const body = { agentId: 'agent-1', name: '', workspace: { type: 'system' } }

    it('reports a user-started session with the Agent kind', async () => {
      createMock.mockReturnValueOnce({ id: 'session-new', agentId: 'agent-1' })
      getAgentMock.mockReturnValueOnce({ id: 'agent-1', configuration: { builtin_role: 'assistant' } })

      await expect(agentSessionHandlers['/agent-sessions'].POST({ body } as never)).resolves.toMatchObject({
        id: 'session-new'
      })
      expect(trackProductEventMock).toHaveBeenCalledWith({ event: 'agent_session_created', agentKind: 'builtin' })
    })

    it('still returns the session when analytics fails', async () => {
      createMock.mockReturnValueOnce({ id: 'session-new', agentId: 'agent-1' })
      trackProductEventMock.mockImplementationOnce(() => {
        throw new Error('analytics down')
      })

      await expect(agentSessionHandlers['/agent-sessions'].POST({ body } as never)).resolves.toMatchObject({
        id: 'session-new'
      })
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
