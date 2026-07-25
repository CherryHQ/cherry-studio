import type { CherryUIMessage } from '@shared/data/types/message'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const appendMessageMock = vi.fn()
const enrichStatsWithCostMock = vi.fn()

vi.mock('@main/data/services/TemporaryChatService', () => ({
  temporaryChatService: { appendMessage: appendMessageMock }
}))

vi.mock('@main/data/services/utils/costEnrichment', () => ({
  enrichStatsWithCost: (...args: unknown[]) => enrichStatsWithCostMock(...args)
}))

const { TemporaryChatBackend } = await import('../TemporaryChatBackend')

beforeEach(() => {
  appendMessageMock.mockReset()
  enrichStatsWithCostMock.mockReset()
})

describe('TemporaryChatBackend.persistAssistant', () => {
  it('enriches stats with the provider-reported cost before appending', async () => {
    // Without this, keeping the chat re-records the ledger row from stats that
    // carry no cost — the promotion write would downgrade the provider charge
    // to a locally computed estimate.
    enrichStatsWithCostMock.mockResolvedValue({
      totalTokens: 15,
      cost: 0.9,
      costCurrency: 'USD',
      costSource: 'provider'
    })
    const backend = new TemporaryChatBackend({ topicId: 'topic-1', messageId: 'msg-1', modelId: 'openai::gpt-4o' })

    await backend.persistAssistant({
      finalMessage: {
        id: 'final',
        role: 'assistant',
        parts: [{ type: 'text', text: 'yo' }],
        metadata: { providerCostUsd: 0.9 }
      } as unknown as CherryUIMessage,
      status: 'success',
      modelId: 'openai::gpt-4o',
      stats: { totalTokens: 15 }
    })

    expect(enrichStatsWithCostMock).toHaveBeenCalledWith({ totalTokens: 15 }, 'openai::gpt-4o', 0.9)
    const [topicId, dto, messageId] = appendMessageMock.mock.calls[0]
    expect(topicId).toBe('topic-1')
    expect(messageId).toBe('msg-1')
    expect(dto.stats).toMatchObject({ cost: 0.9, costCurrency: 'USD', costSource: 'provider' })
  })
})
