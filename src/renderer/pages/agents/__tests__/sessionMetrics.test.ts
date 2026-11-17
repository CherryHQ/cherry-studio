import { describe, expect, it } from 'vitest'

import type { CherryMessagePart, CherryUIMessage, MessageStats } from '@shared/data/types/message'

import { buildAgentSessionMetrics } from '../sessionMetrics'

function assistant(id: string, stats?: MessageStats, status = 'success'): CherryUIMessage {
  return {
    id,
    role: 'assistant',
    parts: [],
    status,
    metadata: stats ? { stats } : {}
  } as unknown as CherryUIMessage
}

const toolPart = (type: string) => ({ type }) as unknown as CherryMessagePart

describe('buildAgentSessionMetrics', () => {
  it('sums per-message token stats and derives cache hit rate from the sums', () => {
    const messages = [
      assistant('a', {
        inputTokens: 1000,
        outputTokens: 100,
        inputTokenDetails: { cacheReadTokens: 800, cacheWriteTokens: 50 }
      }),
      assistant('b', {
        inputTokens: 3000,
        outputTokens: 300,
        inputTokenDetails: { cacheReadTokens: 2400, cacheWriteTokens: 0 }
      })
    ]

    const metrics = buildAgentSessionMetrics(messages, {})

    expect(metrics).toMatchObject({
      turns: 2,
      inputTokens: 4000,
      outputTokens: 400,
      cacheReadTokens: 3200,
      cacheWriteTokens: 50,
      cacheHitRate: 0.8
    })
  })

  it('counts tool-call parts across turns as tool steps', () => {
    const messages = [assistant('a', { inputTokens: 1 }), assistant('b', { inputTokens: 1 })]
    const parts = {
      a: [toolPart('tool-Read'), toolPart('text'), toolPart('dynamic-tool')],
      b: [toolPart('tool-Bash')]
    }

    expect(buildAgentSessionMetrics(messages, parts).toolSteps).toBe(3)
  })

  it('returns undefined rather than zero when source data is missing', () => {
    const metrics = buildAgentSessionMetrics([assistant('a', { outputTokens: 10 })], {})

    expect(metrics.inputTokens).toBeUndefined()
    expect(metrics.cacheHitRate).toBeUndefined()
    expect(metrics.timeFirstTokenMs).toBeUndefined()
    expect(metrics.tokensPerSecond).toBeUndefined()
  })

  it('ignores user messages and assistant messages that have not completed', () => {
    const user = { id: 'u', role: 'user', parts: [], metadata: {} } as unknown as CherryUIMessage
    const metrics = buildAgentSessionMetrics([user, assistant('a', undefined, 'pending')], {})

    expect(metrics.turns).toBe(0)
  })

  it('counts completed turns and tool steps after a fork cleared usage stats', () => {
    // Forked history keeps successful messages and tool parts but stores stats: null.
    const forked = [assistant('a'), assistant('b')]
    const parts = { a: [toolPart('tool-Read'), toolPart('text')], b: [toolPart('tool-Bash')] }

    const metrics = buildAgentSessionMetrics(forked, parts)

    expect(metrics.turns).toBe(2)
    expect(metrics.toolSteps).toBe(2)
    expect(metrics.inputTokens).toBeUndefined()
    expect(metrics.outputTokens).toBeUndefined()
  })
})
