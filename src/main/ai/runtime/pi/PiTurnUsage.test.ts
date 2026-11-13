import type { Usage } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'

import { PiTurnUsage } from './PiTurnUsage'

function usage(values: Partial<Omit<Usage, 'cost'>>): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    ...values
  }
}

describe('PiTurnUsage', () => {
  it('sums cached input and reasoning across provider calls in one turn', () => {
    const turn = new PiTurnUsage()
    turn.record(usage({ input: 10, cacheRead: 5, cacheWrite: 2, output: 8, reasoning: 3, totalTokens: 25 }))

    expect(turn.record(usage({ input: 4, output: 6, reasoning: 0, totalTokens: 10 }))).toEqual({
      totalTokens: 35,
      stats: { inputTokens: 21, outputTokens: 14, totalTokens: 35, outputTokenDetails: { reasoningTokens: 3 } }
    })
  })

  it('omits the reasoning breakdown when no call reported one', () => {
    const turn = new PiTurnUsage()

    expect(turn.record(usage({ input: 1, output: 2, totalTokens: 3 })).stats).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      totalTokens: 3
    })
  })

  it('keeps reasoning reported by an earlier call when a later call omits it', () => {
    const turn = new PiTurnUsage()
    turn.record(usage({ output: 5, reasoning: 4, totalTokens: 5 }))

    expect(turn.record(usage({ output: 1, totalTokens: 1 })).stats.outputTokenDetails).toEqual({ reasoningTokens: 4 })
  })

  it('starts the next turn from zero after reset', () => {
    const turn = new PiTurnUsage()
    turn.record(usage({ input: 9, output: 9, reasoning: 9, totalTokens: 18 }))
    turn.reset()

    expect(turn.record(usage({ input: 1, output: 1, totalTokens: 2 }))).toEqual({
      totalTokens: 2,
      stats: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    })
  })
})
