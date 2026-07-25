import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  listSessionMessagesMock,
  getSessionMessageMock,
  updateSessionMessageMock,
  updateSessionMessagePartDiagnosisMock,
  deleteSessionMessageMock
} = vi.hoisted(() => ({
  listSessionMessagesMock: vi.fn(),
  getSessionMessageMock: vi.fn(),
  updateSessionMessageMock: vi.fn(),
  updateSessionMessagePartDiagnosisMock: vi.fn(),
  deleteSessionMessageMock: vi.fn()
}))

vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: {
    listSessionMessages: listSessionMessagesMock,
    getSessionMessage: getSessionMessageMock,
    updateSessionMessage: updateSessionMessageMock,
    updateSessionMessagePartDiagnosis: updateSessionMessagePartDiagnosisMock,
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
      expect(result).toEqual(response)
    })

    it('removes large assistant part payloads without mutating the stored message data', async () => {
      const assistantOutput = { content: 'large tool output' }
      const assistant = {
        id: 'assistant-message',
        role: 'assistant',
        data: {
          parts: [
            { type: 'text', text: 'answer' },
            {
              type: 'dynamic-tool',
              toolName: 'test',
              toolCallId: 'tool-call-1',
              state: 'output-available',
              input: {},
              output: assistantOutput,
              callProviderMetadata: {
                'claude-code': {
                  parentToolCallId: 'parent-tool-call',
                  sdkBlockType: 'tool_use',
                  rawInput: 'large raw input'
                },
                cherry: {
                  transport: 'claude-agent',
                  tool: { type: 'provider' }
                }
              },
              resultProviderMetadata: {
                'claude-code': {
                  parentToolCallId: 'parent-tool-call',
                  sdkBlockType: 'tool_result',
                  rawResult: 'large raw result'
                },
                cherry: {
                  transport: 'claude-agent',
                  tool: { type: 'provider' }
                }
              }
            }
          ]
        }
      }
      const user = {
        id: 'user-message',
        role: 'user',
        data: {
          parts: [{ type: 'dynamic-tool', output: 'keep user output' }]
        }
      }
      listSessionMessagesMock.mockReturnValueOnce({ items: [assistant, user], nextCursor: undefined })

      const result = await agentSessionMessageHandlers['/agent-sessions/:sessionId/messages'].GET({
        params: { sessionId: 'session-1' }
      } as never)

      expect(result).toEqual({
        items: [
          {
            ...assistant,
            data: {
              parts: [
                { type: 'text', text: 'answer' },
                {
                  type: 'dynamic-tool',
                  toolName: 'test',
                  toolCallId: 'tool-call-1',
                  state: 'output-available',
                  input: {},
                  output: '',
                  callProviderMetadata: {
                    'claude-code': {
                      parentToolCallId: 'parent-tool-call',
                      sdkBlockType: 'tool_use'
                    },
                    cherry: {
                      transport: 'claude-agent',
                      tool: { type: 'provider' }
                    }
                  },
                  resultProviderMetadata: {
                    'claude-code': {
                      parentToolCallId: 'parent-tool-call',
                      sdkBlockType: 'tool_result'
                    },
                    cherry: {
                      transport: 'claude-agent',
                      tool: { type: 'provider' },
                      deferredToolResult: {
                        messageId: 'assistant-message',
                        toolCallId: 'tool-call-1',
                        kind: 'output'
                      }
                    }
                  }
                }
              ]
            }
          },
          user
        ],
        nextCursor: undefined
      })
      expect(assistant.data.parts[1]).toMatchObject({
        output: assistantOutput,
        callProviderMetadata: {
          'claude-code': { rawInput: 'large raw input' }
        },
        resultProviderMetadata: {
          'claude-code': { rawResult: 'large raw result' }
        }
      })
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

    it('clears assistant outputs from single-message and update responses', async () => {
      const message = {
        id: 'message-1',
        role: 'assistant',
        data: {
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 'call-1',
              state: 'output-available',
              output: { content: 'large tool output' }
            }
          ]
        }
      }
      getSessionMessageMock.mockReturnValueOnce(message)
      updateSessionMessageMock.mockReturnValueOnce(message)

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId'].GET({
          params: { sessionId: 'session-1', messageId: 'message-1' }
        } as never)
      ).resolves.toMatchObject({ data: { parts: [{ output: '' }] } })

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId'].PATCH({
          params: { sessionId: 'session-1', messageId: 'message-1' },
          body: { data: message.data }
        } as never)
      ).resolves.toMatchObject({ data: { parts: [{ output: '' }] } })

      expect(message.data.parts[0].output).toEqual({ content: 'large tool output' })
    })

    it('clears assistant tool errors while retaining an address for the stored result', async () => {
      const message = {
        id: 'message-1',
        role: 'assistant',
        data: {
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 'call-1',
              state: 'output-error',
              errorText: 'large tool error',
              resultProviderMetadata: {
                'claude-code': {
                  sdkBlockType: 'tool_result',
                  rawResult: 'large raw result'
                }
              }
            }
          ]
        }
      }
      getSessionMessageMock.mockReturnValueOnce(message)

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId'].GET({
          params: { sessionId: 'session-1', messageId: 'message-1' }
        } as never)
      ).resolves.toMatchObject({
        data: {
          parts: [
            {
              errorText: '',
              resultProviderMetadata: {
                'claude-code': { sdkBlockType: 'tool_result' },
                cherry: {
                  deferredToolResult: {
                    messageId: 'message-1',
                    toolCallId: 'call-1',
                    kind: 'error'
                  }
                }
              }
            }
          ]
        }
      })
      expect(message.data.parts[0]).toMatchObject({
        errorText: 'large tool error',
        resultProviderMetadata: { 'claude-code': { rawResult: 'large raw result' } }
      })
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

  describe('/agent-sessions/:sessionId/messages/:messageId/parts/:partIndex/diagnosis', () => {
    it('delegates a selected error-part diagnosis without reading the message into the renderer response', async () => {
      const diagnosis = {
        summary: 'Check the API key',
        category: 'auth',
        explanation: 'The provider rejected the key.',
        steps: [{ text: 'Open provider settings.' }]
      }

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId/parts/:partIndex/diagnosis'].PATCH({
          params: { sessionId: 'session-1', messageId: 'message-1', partIndex: '1' },
          body: { diagnosis }
        } as never)
      ).resolves.toBeUndefined()

      expect(getSessionMessageMock).not.toHaveBeenCalled()
      expect(updateSessionMessagePartDiagnosisMock).toHaveBeenCalledWith('session-1', 'message-1', 1, diagnosis)
    })

    it('rejects an invalid part index before calling the service', async () => {
      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId/parts/:partIndex/diagnosis'].PATCH({
          params: { sessionId: 'session-1', messageId: 'message-1', partIndex: 'invalid' },
          body: {
            diagnosis: {
              summary: 'Summary',
              category: 'unknown',
              explanation: 'Explanation',
              steps: []
            }
          }
        } as never)
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

      expect(updateSessionMessagePartDiagnosisMock).not.toHaveBeenCalled()
    })
  })

  describe('/agent-sessions/:sessionId/messages/:messageId/tool-results/:toolCallId', () => {
    it('returns only the requested tool output from the stored message', async () => {
      const output = { content: 'large tool output' }
      getSessionMessageMock.mockReturnValueOnce({
        id: 'message-1',
        role: 'assistant',
        data: {
          parts: [
            { type: 'dynamic-tool', toolCallId: 'call-1', output: 'other output' },
            { type: 'dynamic-tool', toolCallId: 'call-2', output }
          ]
        }
      })

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId/tool-results/:toolCallId'].GET({
          params: { sessionId: 'session-1', messageId: 'message-1', toolCallId: 'call-2' }
        } as never)
      ).resolves.toEqual({ found: true, result: { kind: 'output', value: output } })

      expect(getSessionMessageMock).toHaveBeenCalledWith('session-1', 'message-1')
    })

    it('reports a tool call whose output has not been stored yet', async () => {
      getSessionMessageMock.mockReturnValueOnce({
        id: 'message-1',
        role: 'assistant',
        data: {
          parts: [{ type: 'dynamic-tool', toolCallId: 'call-1' }]
        }
      })

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId/tool-results/:toolCallId'].GET({
          params: { sessionId: 'session-1', messageId: 'message-1', toolCallId: 'call-1' }
        } as never)
      ).resolves.toEqual({ found: false })
    })

    it('returns a stored tool error without sending it in message history', async () => {
      getSessionMessageMock.mockReturnValueOnce({
        id: 'message-1',
        role: 'assistant',
        data: {
          parts: [
            {
              type: 'dynamic-tool',
              toolCallId: 'call-1',
              state: 'output-error',
              errorText: 'large tool error'
            }
          ]
        }
      })

      await expect(
        agentSessionMessageHandlers['/agent-sessions/:sessionId/messages/:messageId/tool-results/:toolCallId'].GET({
          params: { sessionId: 'session-1', messageId: 'message-1', toolCallId: 'call-1' }
        } as never)
      ).resolves.toEqual({ found: true, result: { kind: 'error', value: 'large tool error' } })
    })
  })
})
