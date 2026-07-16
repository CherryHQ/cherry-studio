import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { adaptAgentChunk, AI_SDK_AGENT_TRANSPORT } from './streamAdapter'

describe('adaptAgentChunk', () => {
  it('drops the inner start so it cannot clobber the host assistant message id', () => {
    expect(adaptAgentChunk({ type: 'start', messageId: 'random-uuid' } as UIMessageChunk)).toBeNull()
  })

  it('forwards content and lifecycle chunks untouched', () => {
    const chunks: UIMessageChunk[] = [
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'hi' },
      { type: 'text-end', id: 't1' },
      { type: 'finish' } as UIMessageChunk
    ]
    for (const chunk of chunks) {
      expect(adaptAgentChunk(chunk)).toBe(chunk)
    }
  })

  it('stamps tool chunks with the runtime transport tag, preserving existing metadata', () => {
    const chunk = {
      type: 'tool-input-start',
      toolCallId: 'call-1',
      toolName: 'read',
      providerMetadata: { cherry: { tool: { type: 'builtin', name: 'read' } }, other: { keep: true } }
    } as unknown as UIMessageChunk

    const adapted = adaptAgentChunk(chunk) as { providerMetadata: Record<string, unknown> }

    expect(adapted).not.toBe(chunk)
    expect(adapted.providerMetadata.cherry).toEqual({
      tool: { type: 'builtin', name: 'read' },
      transport: AI_SDK_AGENT_TRANSPORT
    })
    expect(adapted.providerMetadata.other).toEqual({ keep: true })
  })

  it('stamps every tool lifecycle chunk shape', () => {
    const toolChunks = [
      { type: 'tool-input-start', toolCallId: 'c', toolName: 'read' },
      { type: 'tool-input-available', toolCallId: 'c', toolName: 'read', input: {} },
      { type: 'tool-output-available', toolCallId: 'c', output: 'ok' },
      { type: 'tool-output-error', toolCallId: 'c', errorText: 'nope' }
    ] as unknown as UIMessageChunk[]

    for (const chunk of toolChunks) {
      const adapted = adaptAgentChunk(chunk) as unknown as { providerMetadata: { cherry: { transport: string } } }
      expect(adapted.providerMetadata.cherry.transport, chunk.type).toBe(AI_SDK_AGENT_TRANSPORT)
    }
  })
})
