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
    // Agent ids are UUID v4 (remapAgentPrefixIds rewrites legacy prefix ids),
    // and AgentSessionOwnerScopeSchema enforces uuid | 'unlinked'.
    const AGENT_ID = '018f6ed6-73b8-4f40-8d0d-9bb2f8f1d001'

    it('forwards query to agentSessionService.listByCursor', async () => {
      const response = { items: [], nextCursor: undefined }
      listByCursorMock.mockResolvedValueOnce(response)

      const result = await agentSessionHandlers['/agent-sessions'].GET({
        query: {
          agentId: AGENT_ID,
          limit: '10',
          pinned: false,
          sortBy: 'lastActivityAt'
        }
      } as never)

      expect(listByCursorMock).toHaveBeenCalledWith({
        agentId: AGENT_ID,
        limit: 10,
        pinned: false,
        sortBy: 'lastActivityAt'
      })
      expect(result).toBe(response)
    })
  })

  describe('/agent-sessions/latest', () => {
    it('wraps the latest session from AgentSessionService', async () => {
      const session = { id: 'session-latest' }
      getLatestActiveMock.mockReturnValueOnce(session)

      await expect(agentSessionHandlers['/agent-sessions/latest'].GET({} as never)).resolves.toEqual({ session })
      expect(getLatestActiveMock).toHaveBeenCalledWith({})
    })

    it('returns { session: null } when there are no sessions', async () => {
      getLatestActiveMock.mockReturnValueOnce(null)

      await expect(agentSessionHandlers['/agent-sessions/latest'].GET({} as never)).resolves.toEqual({ session: null })
    })

    it('rejects the aggregate unlinked owner scope', async () => {
      await expect(
        agentSessionHandlers['/agent-sessions/latest'].GET({ query: { agentId: 'unlinked' } } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

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
