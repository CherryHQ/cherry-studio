import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

const appendAssistantMessageMock = vi.fn()

vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: { appendAssistantMessage: appendAssistantMessageMock }
}))

const { TemporaryChatBackend } = await import('../TemporaryChatBackend')

beforeEach(() => {
  appendAssistantMessageMock.mockReset()
})

describe('TemporaryChatBackend.persistAssistant', () => {
  it('persists the final message finish reason', async () => {
    const backend = new TemporaryChatBackend({ topicId: 'topic-1', messageId: 'msg-1' })
    await backend.persistAssistant({
      finalMessage: { id: 'msg-1', role: 'assistant', parts: [], metadata: { finishReason: 'length' } },
      status: 'success'
    })
    expect(appendAssistantMessageMock.mock.calls[0][1].data).toEqual({ parts: [], finishReason: 'length' })
  })

  it('passes only runtimeTiming to the data-layer owner', async () => {
    const backend = new TemporaryChatBackend({ topicId: 'topic-1', messageId: 'msg-1', modelId: 'openai::gpt-4o' })
    const runtimeTiming = { startedAt: 100, completedAt: 600, spans: [] }

    await backend.persistAssistant({
      finalMessage: {
        id: 'final',
        role: 'assistant',
        parts: [{ type: 'text', text: 'yo' }],
        metadata: {}
      } as unknown as CherryUIMessage,
      status: 'success',
      modelId: 'openai::gpt-4o',
      runtimeStats: { runtimeTiming }
    })

    const [topicId, dto, runtimeStats, messageId] = appendAssistantMessageMock.mock.calls[0]
    expect(topicId).toBe('topic-1')
    expect(messageId).toBe('msg-1')
    expect(dto).not.toHaveProperty('stats')
    expect(runtimeStats).toEqual({ runtimeTiming })
  })
})
