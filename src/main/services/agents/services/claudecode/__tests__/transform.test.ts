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

  it('if no tags present, returns original string', () => {
    const input = 'just some normal text'
    expect(stripLocalCommandTags(input)).toBe(input)
  })
})

describe('Claude → AiSDK transform', () => {
  it('handles tool call streaming lifecycle', () => {
    const state = new ClaudeStreamState()
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
    expect(toolResult.toolCallId).toBe('tool-1')
    expect(toolResult.toolName).toBe('Bash')
    expect(toolResult.input).toEqual({ command: 'ls' })
    expect(toolResult.output).toBe('ok')
  })

  it('handles tool calls without streaming events (no content_block_start/stop)', () => {
    const state = new ClaudeStreamState()
    const parts: ReturnType<typeof transformSDKMessageToStreamParts>[number][] = []

    const messages: SDKMessage[] = [
      {
        ...baseStreamMetadata,
        type: 'assistant',
        uuid: uuid(20),
        message: {
          id: 'msg-tool-no-stream',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [
            {
              type: 'tool_use',
              id: 'tool-read',
              name: 'Read',
              input: { file_path: '/test.txt' }
            },
            {
              type: 'tool_use',
              id: 'tool-bash',
              name: 'Bash',
              input: { command: 'ls -la' }
            }
          ],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: {
            input_tokens: 10,
            output_tokens: 20
          }
        }
      } as unknown as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'user',
        uuid: uuid(21),
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-read',
              content: 'file contents',
              is_error: false
            }
          ]
        }
      } as SDKMessage,
      {
        ...baseStreamMetadata,
        type: 'user',
        uuid: uuid(22),
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tool-bash',
              content: 'total 42\n...',
              is_error: false
            }
          ]
        }
      } as SDKMessage
    ]

    for (const message of messages) {
      const transformed = transformSDKMessageToStreamParts(message, state)
      parts.push(...transformed)
    }

    const types = parts.map((part) => part.type)
    expect(types).toEqual(['tool-call', 'tool-call', 'tool-result', 'tool-result'])

    const toolCalls = parts.filter((part) => part.type === 'tool-call') as Extract<
      (typeof parts)[number],
      { type: 'tool-call' }
    >[]
    expect(toolCalls).toHaveLength(2)
    expect(toolCalls[0].toolName).toBe('Read')
    expect(toolCalls[0].toolCallId).toBe('tool-read')
    expect(toolCalls[1].toolName).toBe('Bash')
    expect(toolCalls[1].toolCallId).toBe('tool-bash')

    const toolResults = parts.filter((part) => part.type === 'tool-result') as Extract<
      (typeof parts)[number],
      { type: 'tool-result' }
    >[]
    expect(toolResults).toHaveLength(2)
    // This is the key assertion - toolName should NOT be 'unknown'
    expect(toolResults[0].toolName).toBe('Read')
    expect(toolResults[0].toolCallId).toBe('tool-read')
    expect(toolResults[0].input).toEqual({ file_path: '/test.txt' })
    expect(toolResults[0].output).toBe('file contents')

    expect(toolResults[1].toolName).toBe('Bash')
    expect(toolResults[1].toolCallId).toBe('tool-bash')
    expect(toolResults[1].input).toEqual({ command: 'ls -la' })
    expect(toolResults[1].output).toBe('total 42\n...')
  })

  it('handles streaming text completion', () => {
    const state = new ClaudeStreamState()
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

  it('emits fallback text when Claude sends a snapshot instead of deltas', () => {
    const state = new ClaudeStreamState()
    const parts: ReturnType<typeof transformSDKMessageToStreamParts>[number][] = []

    const messages: SDKMessage[] = [
      {
        ...baseStreamMetadata,
        type: 'stream_event',
        uuid: uuid(30),
        event: {
          type: 'message_start',
          message: {
            id: 'msg-fallback',
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
        uuid: uuid(31),
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
        type: 'assistant',
        uuid: uuid(32),
        message: {
          id: 'msg-fallback-content',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [
            {
              type: 'text',
              text: 'Final answer without streaming deltas.'
            }
          ],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 3,
            output_tokens: 7
          }
        }
      } as unknown as SDKMessage
    ]

    for (const message of messages) {
      const transformed = transformSDKMessageToStreamParts(message, state)
      parts.push(...transformed)
    }

    const types = parts.map((part) => part.type)
    expect(types).toEqual(['start-step', 'text-start', 'text-delta', 'text-end', 'finish-step'])

    const delta = parts.find((part) => part.type === 'text-delta') as Extract<
      (typeof parts)[number],
      { type: 'text-delta' }
    >
    expect(delta.text).toBe('Final answer without streaming deltas.')

    const finish = parts.find((part) => part.type === 'finish-step') as Extract<
      (typeof parts)[number],
      { type: 'finish-step' }
    >
    expect(finish.usage).toEqual({ inputTokens: 3, outputTokens: 7, totalTokens: 10 })
    expect(finish.finishReason).toBe('stop')
  })
})
