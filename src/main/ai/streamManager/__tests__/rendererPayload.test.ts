import type { StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  projectStreamChunkForRenderer,
  projectStreamChunkPayloadForRenderer,
  projectStreamMessageForRenderer
} from '../rendererPayload'

describe('rendererPayload', () => {
  it('removes large agent tool output fields from a final message without mutating the source', () => {
    const part = {
      type: 'dynamic-tool',
      toolName: 'Read',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { file_path: '/tmp/example.txt' },
      output: { content: 'large output' },
      callProviderMetadata: {
        'claude-code': {
          parentToolCallId: null,
          sdkBlockType: 'tool_use',
          rawInput: 'large raw input'
        },
        cherry: { transport: 'claude-agent' }
      },
      resultProviderMetadata: {
        'claude-code': {
          parentToolCallId: null,
          sdkBlockType: 'tool_result',
          rawResult: 'large raw result'
        },
        cherry: { transport: 'claude-agent' }
      }
    }
    const message = {
      id: 'message-1',
      role: 'assistant',
      parts: [part]
    } as unknown as CherryUIMessage

    const projected = projectStreamMessageForRenderer('agent-session:session-1', message)

    expect(projected.parts[0]).toEqual({
      ...part,
      output: '',
      callProviderMetadata: {
        'claude-code': {
          parentToolCallId: null,
          sdkBlockType: 'tool_use'
        },
        cherry: { transport: 'claude-agent' }
      },
      resultProviderMetadata: {
        'claude-code': {
          parentToolCallId: null,
          sdkBlockType: 'tool_result'
        },
        cherry: {
          transport: 'claude-agent',
          deferredToolResult: {
            messageId: 'message-1',
            toolCallId: 'call-1',
            kind: 'output'
          }
        }
      }
    })
    expect(part).toMatchObject({
      output: { content: 'large output' },
      callProviderMetadata: { 'claude-code': { rawInput: 'large raw input' } },
      resultProviderMetadata: { 'claude-code': { rawResult: 'large raw result' } }
    })
  })

  it('removes agent tool chunk output and raw provider metadata without mutating the source', () => {
    const chunk = {
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: { content: 'large output' },
      providerMetadata: {
        'claude-code': {
          parentToolCallId: null,
          sdkBlockType: 'tool_result',
          rawResult: 'large raw result'
        },
        cherry: { transport: 'claude-agent' }
      }
    } as unknown as UIMessageChunk

    const projected = projectStreamChunkForRenderer('agent-session:session-1', chunk, 'message-1')

    expect(projected).toEqual({
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: '',
      providerMetadata: {
        'claude-code': {
          parentToolCallId: null,
          sdkBlockType: 'tool_result'
        },
        cherry: {
          transport: 'claude-agent',
          deferredToolResult: {
            messageId: 'message-1',
            toolCallId: 'call-1',
            kind: 'output'
          }
        }
      }
    })
    expect(chunk).toMatchObject({
      output: { content: 'large output' },
      providerMetadata: { 'claude-code': { rawResult: 'large raw result' } }
    })
  })

  it('removes large tool error text and exposes an error result reference', () => {
    const chunk = {
      type: 'tool-output-error',
      toolCallId: 'call-1',
      errorText: 'large error output',
      providerMetadata: {
        'claude-code': {
          sdkBlockType: 'tool_result',
          rawResult: 'large raw result'
        }
      }
    } as unknown as UIMessageChunk

    expect(projectStreamChunkForRenderer('agent-session:session-1', chunk, 'message-1')).toEqual({
      type: 'tool-output-error',
      toolCallId: 'call-1',
      errorText: '',
      providerMetadata: {
        'claude-code': {
          sdkBlockType: 'tool_result'
        },
        cherry: {
          deferredToolResult: {
            messageId: 'message-1',
            toolCallId: 'call-1',
            kind: 'error'
          }
        }
      }
    })
    expect(chunk).toMatchObject({
      errorText: 'large error output',
      providerMetadata: { 'claude-code': { rawResult: 'large raw result' } }
    })
  })

  it('keeps tool result content when no source message id is available', () => {
    const chunk = {
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: 'large output'
    } as UIMessageChunk

    expect(projectStreamChunkForRenderer('agent-session:session-1', chunk)).toBe(chunk)
  })

  it('removes raw input metadata from agent tool input chunks', () => {
    const chunk = {
      type: 'tool-input-available',
      toolCallId: 'call-1',
      toolName: 'Read',
      input: { file_path: '/tmp/example.txt' },
      providerMetadata: {
        'claude-code': {
          sdkBlockType: 'tool_use',
          rawInput: 'large raw input'
        }
      }
    } as unknown as UIMessageChunk

    expect(projectStreamChunkForRenderer('agent-session:session-1', chunk)).toEqual({
      type: 'tool-input-available',
      toolCallId: 'call-1',
      toolName: 'Read',
      input: { file_path: '/tmp/example.txt' },
      providerMetadata: {
        'claude-code': {
          sdkBlockType: 'tool_use'
        }
      }
    })
  })

  it('projects reconnect payloads only for agent-session topics', () => {
    const sourceChunk = {
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: 'large output'
    }
    const chunk = sourceChunk as UIMessageChunk
    const agentPayload = {
      topicId: 'agent-session:session-1',
      anchorMessageId: 'message-1',
      chunk
    } as StreamChunkPayload
    const chatPayload = {
      topicId: 'chat-topic',
      chunk
    } as StreamChunkPayload

    expect(projectStreamChunkPayloadForRenderer(agentPayload)).toEqual({
      topicId: 'agent-session:session-1',
      anchorMessageId: 'message-1',
      chunk: {
        type: 'tool-output-available',
        toolCallId: 'call-1',
        output: '',
        providerMetadata: {
          cherry: {
            deferredToolResult: {
              messageId: 'message-1',
              toolCallId: 'call-1',
              kind: 'output'
            }
          }
        }
      }
    })
    expect(projectStreamChunkPayloadForRenderer(chatPayload)).toBe(chatPayload)
    expect(sourceChunk.output).toBe('large output')
  })
})
