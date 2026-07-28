import type { CherryUIMessage } from '@shared/data/types/message'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appendMessageMock = vi.fn()
const getMessageUsageProjectionMock = vi.fn()

vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: { appendMessage: appendMessageMock }
}))

vi.mock('@main/data/services/aiUsageRecord', () => ({
  aiUsageRecordService: {
    getMessageUsageProjection: (...args: unknown[]) => getMessageUsageProjectionMock(...args)
  }
}))

const { TemporaryChatBackend } = await import('../TemporaryChatBackend')

beforeEach(() => {
  appendMessageMock.mockReset()
  getMessageUsageProjectionMock.mockReset()
})

describe('TemporaryChatBackend.persistAssistant', () => {
  it('combines the record projection with message timing before appending', async () => {
    getMessageUsageProjectionMock.mockReturnValue({
      totalTokens: 15,
      requestCount: 1,
      costs: [{ currency: 'USD', amount: 0.9, providerReportedRequestCount: 1, computedRequestCount: 0 }]
    })
    const backend = new TemporaryChatBackend({ topicId: 'topic-1', messageId: 'msg-1', modelId: 'openai::gpt-4o' })

    await backend.persistAssistant({
      finalMessage: {
        id: 'final',
        role: 'assistant',
        parts: [{ type: 'text', text: 'yo' }],
        metadata: {}
      } as unknown as CherryUIMessage,
      status: 'success',
      modelId: 'openai::gpt-4o',
      stats: { totalTokens: 999, timeCompletionMs: 500 }
    })

    expect(getMessageUsageProjectionMock).toHaveBeenCalledWith({ kind: 'chat', id: 'msg-1' })
    const [topicId, dto, messageId] = appendMessageMock.mock.calls[0]
    expect(topicId).toBe('topic-1')
    expect(messageId).toBe('msg-1')
    expect(dto.stats).toEqual({
      totalTokens: 15,
      requestCount: 1,
      costs: [{ currency: 'USD', amount: 0.9, providerReportedRequestCount: 1, computedRequestCount: 0 }],
      timeCompletionMs: 500
    })
  })
})
