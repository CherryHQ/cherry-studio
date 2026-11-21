import { MockApplicationUtils } from '@test-mocks/main/application'
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
    MockApplicationUtils.setService('AgentSessionRuntimeService', {
      getHistoryActions: () =>
        new Map([
          ['assistant-message', { fork: 'legacy_history', edit: 'invalid_target' }],
          ['user-message', { fork: 'not_turn_boundary', edit: 'checkpoint_unsupported' }]
        ])
    })
    // `getConversationById` is synchronous; scope violations throw inline.
    getConversationByIdMock.mockReturnValue({ id: 'session-1' })
  })

  describe('/agent-sessions/:sessionId/messages', () => {
    it.each([
      { name: 'default', query: undefined, options: {} },
      { name: 'verbatim', query: { deferToolOutputs: false }, options: { deferToolOutputs: false } },
      {
        name: 'projected',
        query: { deferToolOutputs: true, limit: 2, cursor: '100:previous', messageId: 'anchor' },
        options: { deferToolOutputs: true, limit: 2, cursor: '100:previous', messageId: 'anchor' }
      }
    ])('forwards parsed $name options and attaches history actions by message ID', async ({ query, options }) => {
      const user = { id: 'user-message', role: 'user', data: { parts: [] } }
      const assistant = { id: 'assistant-message', role: 'assistant', data: { parts: [] } }
      listSessionMessagesMock.mockReturnValueOnce({ items: [user, assistant], nextCursor: '50:older' })

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
          params: { sessionId: 'session-1' },
          query
        })
      ).resolves.toEqual({
        items: [
          { ...user, historyActions: { fork: 'not_turn_boundary', edit: 'checkpoint_unsupported' } },
          { ...assistant, historyActions: { fork: 'legacy_history', edit: 'invalid_target' } }
        ],
        nextCursor: '50:older'
      })
      expect(listSessionMessagesMock).toHaveBeenCalledWith('session-1', options)
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
    it('includes renderer history actions in a projected message read', async () => {
      const projected = { id: 'assistant-message', data: { parts: [] } }
      getSessionMessageMock.mockReturnValueOnce(projected)

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId'].GET({
          params: { sessionId: 'session-1', messageId: projected.id },
          query: { deferToolOutputs: true }
        })
      ).resolves.toEqual({ ...projected, historyActions: { fork: 'legacy_history', edit: 'invalid_target' } })
    })

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
