import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DataApiErrorFactory, ErrorCode } from '@shared/data/api/errors'

const {
  getConversationByIdMock,
  listSessionMessagesMock,
  getSessionMessageMock,
  updateSessionMessageMock,
  deleteSessionMessageMock
} = vi.hoisted(() => ({
  getConversationByIdMock: vi.fn(),
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

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    getConversationById: getConversationByIdMock
  }
}))

import { agentSessionMessageHandlers } from '../agentSessionMessages'

describe('agentSessionMessageHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // `getConversationById` is synchronous; scope violations throw inline.
    getConversationByIdMock.mockReturnValue({ id: 'session-1' })
  })

  describe('/agent-sessions/:sessionId/messages', () => {
    it('forwards messageId query to agentSessionMessageService.listSessionMessages', async () => {
      // `listSessionMessages` is synchronous (better-sqlite3), so the mock must return, not resolve.
      const response = { items: [], nextCursor: undefined }
      listSessionMessagesMock.mockReturnValueOnce(response)

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

    it.each([true, false])(
      'forwards explicit deferToolOutputs=%s and preserves the response cursor',
      async (deferToolOutputs) => {
        const response = { items: [], nextCursor: '100:message-1' }
        listSessionMessagesMock.mockReturnValueOnce(response)
        const result = await agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
          params: { sessionId: 'session-1' },
          query: { deferToolOutputs, limit: '25', messageId: 'message-1' }
        } as never)
        expect(listSessionMessagesMock).toHaveBeenCalledWith('session-1', {
          deferToolOutputs,
          limit: 25,
          messageId: 'message-1'
        })
        expect(result).toBe(response)
      }
    )

    it.each([201, 0, -1, 1.5])('rejects invalid list limit %s before reading messages', async (limit) => {
      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
          params: { sessionId: 'session-1' },
          query: { limit }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      expect(listSessionMessagesMock).not.toHaveBeenCalled()
    })

    it('propagates a non-retryable service DataApiError unchanged', async () => {
      const details = {
        operation: 'listSessionMessages',
        reason: 'AGENT_SESSION_MESSAGE_READ_BUDGET_EXCEEDED',
        scope: 'message',
        messageId: 'message-1'
      }
      const error = DataApiErrorFactory.create(
        ErrorCode.INVALID_OPERATION,
        'History read exceeds the safety limit',
        details
      )
      listSessionMessagesMock.mockImplementationOnce(() => {
        throw error
      })
      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({ params: { sessionId: 'session-1' } })
      ).rejects.toBe(error)
      expect(error.isRetryable).toBe(false)
    })

    it('hides the message list of a session outside the conversation scope', async () => {
      getConversationByIdMock.mockImplementationOnce(() => {
        throw new Error('not found')
      })

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
          params: { sessionId: 'session-bg' }
        })
      ).rejects.toThrow('not found')

      expect(listSessionMessagesMock).not.toHaveBeenCalled()
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
        })
      ).resolves.toBe(existing)

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId'].PATCH({
          params: { sessionId: 'session-1', messageId: 'message-1' },
          body: { data }
        })
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

    it('refuses to read, update, or delete messages of a background session', async () => {
      getConversationByIdMock.mockImplementation(() => {
        throw new Error('not found')
      })
      const call = (method: 'GET' | 'PATCH' | 'DELETE') =>
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId'][method]({
          params: { sessionId: 'session-bg', messageId: 'message-1' },
          body: { data: { parts: [] } }
        } as never)

      await expect(call('GET')).rejects.toThrow('not found')
      await expect(call('PATCH')).rejects.toThrow('not found')
      await expect(call('DELETE')).rejects.toThrow('not found')

      expect(getSessionMessageMock).not.toHaveBeenCalled()
      expect(updateSessionMessageMock).not.toHaveBeenCalled()
      expect(deleteSessionMessageMock).not.toHaveBeenCalled()
    })
  })
})
