import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'

import { ClaudeStreamState, stripLocalCommandTags, transformSDKMessageToStreamParts } from '../transform'

const baseStreamMetadata = {
  parent_tool_use_id: null,
  session_id: 'session-123'
}

const uuid = (n: number) => `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`

describe('stripLocalCommandTags', () => {
  it('removes stdout wrapper while preserving inner text', () => {
    const input = 'before <local-command-stdout>echo "hi"</local-command-stdout> after'
    expect(stripLocalCommandTags(input)).toBe('before echo "hi" after')
  })

  it('strips multiple stdout/stderr blocks and leaves other content intact', () => {
    const input =
      '<local-command-stdout>line1</local-command-stdout>\nkeep\n<local-command-stderr>Error</local-command-stderr>'
    expect(stripLocalCommandTags(input)).toBe('line1\nkeep\nError')
  })
})

describe('Claude → AiSDK transform', () => {
  it('handles tool call streaming lifecycle', () => {
    const state = new ClaudeStreamState({ agentSessionId: baseStreamMetadata.session_id })
    const parts: ReturnType<typeof transformSDKMessageToStreamParts>[number][] = []

    const messages: SDKMessage[] = [
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(1),
        event: {
          type: 'message_start',
          message: {
            id: 'msg-start',
            type: 'message',
            role: 'assistant',
            model: 'claude-test',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {}
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(2),
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Bash',
            input: {}
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(3),
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"command":"ls"}'
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'assistant',
        uuid: uuid(4),
        message: {
          id: 'msg-tool',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'Bash',
              input: {
                command: 'ls'
              }
            }
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 1,
            output_tokens: 0
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(5),
        event: {
          type: 'content_block_stop',
          index: 0
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(6),
        event: {
          type: 'message_delta',
          delta: {
            stop_reason: 'tool_use',
            stop_sequence: null
          },
          usage: {
            input_tokens: 1,
            output_tokens: 5
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(7),
        event: {
          type: 'message_stop'
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'user',
        uuid: uuid(8),
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-1',
              content: 'ok',
              is_error: false
            }
          ]
        }
      } as SDKMessage
    ]

    for (const message of messages) {
      const transformed = transformSDKMessageToStreamParts(message, state)
      for (const part of transformed) {
        parts.push(part)
      }
    }

    const types = parts.map((part) => part.type)
    expect(types).toEqual([
      'start-step',
      'tool-input-start',
      'tool-input-delta',
      'tool-call',
      'tool-input-end',
      'finish-step',
      'tool-result'
    ])

    const finishStep = parts.find((part) => part.type === 'finish-step') as Extract<
      (typeof parts)[number],
      { type: 'finish-step' }
    >
    expect(finishStep.finishReason).toBe('tool-calls')
    expect(finishStep.usage).toEqual({ inputTokens: 1, outputTokens: 5, totalTokens: 6 })

    const toolResult = parts.find((part) => part.type === 'tool-result') as Extract<
      (typeof parts)[number],
      { type: 'tool-result' }
    >
    expect(toolResult.toolCallId).toBe('session-123:tool-1')
    expect(toolResult.toolName).toBe('Bash')
    expect(toolResult.input).toEqual({ command: 'ls' })
    expect(toolResult.output).toBe('ok')
  })

  it('handles streaming text completion', () => {
    const state = new ClaudeStreamState({ agentSessionId: baseStreamMetadata.session_id })
    const parts: ReturnType<typeof transformSDKMessageToStreamParts>[number][] = []

    const messages: SDKMessage[] = [
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(9),
        event: {
          type: 'message_start',
          message: {
            id: 'msg-text',
            type: 'message',
            role: 'assistant',
            model: 'claude-text',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {}
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(10),
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'text',
            text: ''
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(11),
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: 'Hello'
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(12),
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: ' world'
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(13),
        event: {
          type: 'content_block_stop',
          index: 0
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(14),
        event: {
          type: 'message_delta',
          delta: {
            stop_reason: 'end_turn',
            stop_sequence: null
          },
          usage: {
            input_tokens: 2,
            output_tokens: 4
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(15),
        event: {
          type: 'message_stop'
        }
      } as SDKMessage
    ]

    for (const message of messages) {
      const transformed = transformSDKMessageToStreamParts(message, state)
      parts.push(...transformed)
    }

    const types = parts.map((part) => part.type)
    expect(types).toEqual(['start-step', 'text-start', 'text-delta', 'text-delta', 'text-end', 'finish-step'])

    const finishStep = parts.find((part) => part.type === 'finish-step') as Extract<
      (typeof parts)[number],
      { type: 'finish-step' }
    >
    expect(finishStep.finishReason).toBe('stop')
    expect(finishStep.usage).toEqual({ inputTokens: 2, outputTokens: 4, totalTokens: 6 })
  })
})
