import { describe, expect, it, vi } from 'vitest'

const hasPendingSteer = vi.fn()
vi.mock('@main/core/application', () => ({
  application: { get: vi.fn(() => ({ hasPendingSteer })) }
}))
vi.mock('../../../../agentSession/topic', () => ({
  isAgentSessionTopic: (id: string) => id.startsWith('agent-session:')
}))

import { steerYieldFeature } from '../steerYield'

const scope = (chatId?: string) => ({ request: { chatId } }) as any

describe('steerYieldFeature', () => {
  it('applies to chat topics, not agent sessions or topicless requests', () => {
    expect(steerYieldFeature.applies?.(scope('topic-1'))).toBe(true)
    expect(steerYieldFeature.applies?.(scope('agent-session:s1'))).toBe(false)
    expect(steerYieldFeature.applies?.(scope(undefined))).toBe(false)
  })

  it('contributes a stop condition that fires only when the topic has a pending steer', () => {
    const [condition] = steerYieldFeature.contributeStopConditions!(scope('topic-1'))

    hasPendingSteer.mockReturnValue(false)
    expect(condition({ steps: [] } as any)).toBe(false)

    hasPendingSteer.mockReturnValue(true)
    expect(condition({ steps: [] } as any)).toBe(true)
    expect(hasPendingSteer).toHaveBeenCalledWith('topic-1')
  })

  it('contributes nothing for a topicless request', () => {
    expect(steerYieldFeature.contributeStopConditions!(scope(undefined))).toEqual([])
  })
})
