import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listSessionMessagesMock, getSessionMessageMock, updateSessionMessageMock, deleteSessionMessageMock } =
  vi.hoisted(() => ({
    listSessionMessagesMock: vi.fn(),
    getSessionMessageMock: vi.fn(),
    updateSessionMessageMock: vi.fn(),
    deleteSessionMessageMock: vi.fn()
  }))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: listSessionMessagesMock,
    getSessionMessage: getSessionMessageMock,
    updateSessionMessage: updateSessionMessageMock,
    deleteSessionMessage: deleteSessionMessageMock
  }
}))

import { agentSessionMessageHandlers } from '../agentSessionMessages'

describe('agentSessionMessageHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/agent-sessions/:sessionId/messages', () => {
    it('forwards messageId query to agentSessionMessageService.listSessionMessages', async () => {
      const response = { items: [], nextCursor: undefined }
      listSessionMessagesMock.mockResolvedValueOnce(response)

      const result = await agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
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

  describe('/agent-sessions/:sessionId/messages/:messageId', () => {
    it('reads and updates a message within its Agent session', async () => {
      const existing = { id: 'message-1', data: { parts: [] } }
      const data = { parts: [{ type: 'text' as const, text: 'updated' }] }
      const updated = { id: 'message-1', data }
      getSessionMessageMock.mockReturnValueOnce(existing)
      updateSessionMessageMock.mockReturnValueOnce(updated)

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId'].GET({
          params: { sessionId: 'session-1', messageId: 'message-1' }
        } as never)
      ).resolves.toBe(existing)

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId'].PATCH({
          params: { sessionId: 'session-1', messageId: 'message-1' },
          body: { data }
        } as never)
      ).resolves.toBe(updated)

      expect(updateSessionMessageMock).toHaveBeenCalledWith('session-1', 'message-1', { data })
    })

    it('rejects an invalid message update before calling the service', async () => {
      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId'].PATCH({
          params: { sessionId: 'session-1', messageId: 'message-1' },
          body: { status: 'success' }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(updateSessionMessageMock).not.toHaveBeenCalled()
    })
  })
})
