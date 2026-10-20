import { beforeEach, describe, expect, it, vi } from 'vitest'

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

    it('replaces an oversized assistant tool output with a reference, leaving the stored data alone', async () => {
      const output = { content: 'x'.repeat(64 * 1024) }
      const assistant = {
        id: 'assistant-message',
        role: 'assistant',
        data: {
          parts: [
            { type: 'text', text: 'answer' },
            { type: 'dynamic-tool', toolCallId: 'tool-call-1', state: 'output-available', input: {}, output }
          ]
        }
      }
      const user = { id: 'user-message', role: 'user', data: { parts: [{ type: 'dynamic-tool', output: 'keep' }] } }
      listSessionMessagesMock.mockReturnValueOnce({ items: [assistant, user], nextCursor: undefined })

      const result = (await agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
        params: { sessionId: 'session-1' },
        query: { deferToolOutputs: true }
      } as never)) as unknown as { items: { data: { parts: unknown[] } }[] }

      expect(result.items[0].data.parts[1]).toEqual({
        type: 'dynamic-tool',
        toolCallId: 'tool-call-1',
        state: 'output-available',
        input: {},
        output: {
          $deferredToolResult: {
            topicId: 'agent-session:session-1',
            messageId: 'assistant-message',
            toolCallId: 'tool-call-1'
          }
        }
      })
      expect(result.items[1]).toBe(user)
      expect(assistant.data.parts[1]).toMatchObject({ output })
    })

    it('leaves a small tool output inline so no round trip is needed to render it', async () => {
      const assistant = {
        id: 'assistant-message',
        role: 'assistant',
        data: {
          parts: [{ type: 'dynamic-tool', toolCallId: 'tool-call-1', state: 'output-available', output: { a: 1 } }]
        }
      }
      listSessionMessagesMock.mockReturnValueOnce({ items: [assistant], nextCursor: undefined })

      const result = (await agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
        params: { sessionId: 'session-1' },
        query: { deferToolOutputs: true }
      } as never)) as unknown as { items: unknown[] }

      expect(result.items[0]).toBe(assistant)
    })

    it('returns stored tool outputs verbatim unless the caller opts in', async () => {
      const output = { content: 'x'.repeat(64 * 1024) }
      const assistant = {
        id: 'assistant-message',
        role: 'assistant',
        data: {
          parts: [{ type: 'dynamic-tool', toolCallId: 'tool-call-1', state: 'output-available', output }]
        }
      }
      const response = { items: [assistant], nextCursor: undefined }
      listSessionMessagesMock.mockReturnValueOnce(response)

      // Default read is verbatim, so a read-modify-write caller cannot persist a trimmed copy.
      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
          params: { sessionId: 'session-1' }
        })
      ).resolves.toBe(response)
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
