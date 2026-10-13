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
  it.each(['success', 'paused', 'error'] as const)(
    'preserves quote snapshots and only runtimeTiming on %s',
    async (status) => {
      const quotes = [{ id: 'quote-1', sourceMessageId: '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d001', text: 'Quoted text' }]
      const backend = new TemporaryChatBackend({
        topicId: 'topic-1',
        messageId: 'msg-1',
        modelId: 'openai::gpt-4o',
        quotes
      })
      const runtimeTiming = { startedAt: 100, completedAt: 600, spans: [] }

      await backend.persistAssistant({
        finalMessage: {
          id: 'final',
          role: 'assistant',
          parts: [{ type: 'text', text: 'yo' }],
          metadata: {}
        } as unknown as CherryUIMessage,
        status,
        modelId: 'openai::gpt-4o',
        runtimeStats: { runtimeTiming }
      })

      const [topicId, dto, runtimeStats, messageId] = appendAssistantMessageMock.mock.calls[0]
      expect(topicId).toBe('topic-1')
      expect(messageId).toBe('msg-1')
      expect(dto).not.toHaveProperty('stats')
      expect(dto.data.quotes).toEqual(quotes)
      expect(dto.status).toBe(status)
      expect(runtimeStats).toEqual({ runtimeTiming })
    }
  )
})
