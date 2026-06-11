import type { MessageStats } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { statsToMetrics, statsToUsage } from '../messageStats'

describe('statsToUsage', () => {
  it('projects all token fields and keeps required fields defaulted to 0 when missing', () => {
    const stats: MessageStats = {
      promptTokens: 30,
      completionTokens: 12,
      totalTokens: 42,
      thoughtsTokens: 3,
      cost: 0.000123
    }

    expect(statsToUsage(stats)).toEqual({
      prompt_tokens: 30,
      completion_tokens: 12,
      total_tokens: 42,
      thoughts_tokens: 3,
      cost: 0.000123
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

  it('keeps cost=0 (OpenRouter can legitimately report a free request)', () => {
    // Guard against `stats.cost !== undefined` becoming `if (stats.cost)`
    // by accident — OpenRouter's free-tier calls report cost: 0 and
    // swallowing that would hide a real value.
    expect(statsToUsage({ cost: 0 })).toMatchObject({ cost: 0 })
  })
})

describe('statsToMetrics', () => {
  it('projects all timing fields and completion tokens', () => {
    const stats: MessageStats = {
      completionTokens: 12,
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
