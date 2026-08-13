import type { MessageStats } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { getCacheTokenStats, statsToMetrics, statsToUsage } from '../messageStats'

describe('statsToUsage', () => {
  it('projects all token fields and keeps required fields defaulted to 0 when missing', () => {
    const stats: MessageStats = {
      inputTokens: 30,
      outputTokens: 12,
      totalTokens: 42,
      outputTokenDetails: { reasoningTokens: 3 }
    }

    expect(statsToUsage(stats)).toEqual({
      prompt_tokens: 30,
      completion_tokens: 12,
      total_tokens: 42,
      thoughts_tokens: 3
    })
  })

  it('projects cache breakdown without projecting record-owned cost', () => {
    const stats: MessageStats = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 900,
      inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 700, cacheWriteTokens: 100 },
      costs: [
        {
          currency: 'USD',
          amount: 0.0042,
          providerReportedRequestCount: 0,
          computedRequestCount: 1
        }
      ]
    }

    expect(statsToUsage(stats)).toMatchObject({
      cache_read_tokens: 700,
      cache_write_tokens: 100
    })
  })

  it('defaults required OpenAI fields to 0 when stats is empty', () => {
    // Keeps downstream consumers (MessageTokens) null-check-free: they
    // read `message.usage.total_tokens` directly and expect a number.
    expect(statsToUsage({})).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    })
  })

  it('omits optional fields entirely when undefined — does not spread as `undefined`', () => {
    const result = statsToUsage({ totalTokens: 7 })
    expect(result).not.toHaveProperty('thoughts_tokens')
    expect(result).not.toHaveProperty('cost')
  })
})

describe('getCacheTokenStats', () => {
  it('computes cache hit rate and saved input tokens for one message', () => {
    expect(
      getCacheTokenStats({ inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 70, cacheWriteTokens: 20 } })
    ).toEqual({
      noCacheTokens: 10,
      cacheReadTokens: 70,
      cacheWriteTokens: 20,
      totalInputTokens: 100,
      hitRate: 0.7,
      savedInputTokens: 70
    })
  })

  it('returns undefined when no cache counters exist', () => {
    expect(getCacheTokenStats({ inputTokens: 10 })).toBeUndefined()
  })

  it('returns undefined when only non-cache input tokens exist', () => {
    expect(getCacheTokenStats({ inputTokenDetails: { noCacheTokens: 100 } })).toBeUndefined()
  })
})

describe('statsToMetrics', () => {
  it('projects all timing fields and completion tokens', () => {
    const stats: MessageStats = {
      outputTokens: 12,
      timeCompletionMs: 1501,
      timeFirstTokenMs: 250,
      timeThinkingMs: 400
    }

    expect(statsToMetrics(stats)).toEqual({
      completion_tokens: 12,
      time_completion_millsec: 1501,
      time_first_token_millsec: 250,
      time_thinking_millsec: 400
    })
  })

  it('defaults completion_tokens / time_completion_millsec to 0 but leaves optional timings undefined', () => {
    // MessageTokens.tsx guards tooltip rendering with:
    //   if (metrics.completion_tokens && metrics.time_completion_millsec)
    // so 0 is the correct sentinel here — it short-circuits the branch
    // without showing "0 tok/s". Optional timing fields must stay
    // undefined so an absent measurement renders as blank, not as 0ms.
    expect(statsToMetrics({})).toEqual({
      completion_tokens: 0,
      time_completion_millsec: 0,
      time_first_token_millsec: undefined,
      time_thinking_millsec: undefined
    })
  })

  it('projects partial measurements (only TTFT present)', () => {
    const result = statsToMetrics({ timeFirstTokenMs: 100 })
    expect(result.time_first_token_millsec).toBe(100)
    expect(result.time_thinking_millsec).toBeUndefined()
    expect(result.time_completion_millsec).toBe(0)
  })
})
