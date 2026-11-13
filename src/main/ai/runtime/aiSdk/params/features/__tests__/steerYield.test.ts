import { describe, expect, it, vi } from 'vitest'

const hasPendingSteer = vi.fn()
vi.mock('@application', () => ({
  application: { get: vi.fn(() => ({ hasPendingSteer })) }
}))
vi.mock('../../../../agentSession/topic', () => ({
  isAgentSessionTopic: (id: string) => id.startsWith('agent-session:')
}))

import { steerYieldFeature } from '../steerYield'

const scope = (topicId?: string) => ({ request: { conversation: { id: topicId ?? 'no-topic', topicId } } }) as any

describe('steerYieldFeature', () => {
  it('contributes a stop condition that fires only when the topic has a pending steer', async () => {
    const [condition] = steerYieldFeature.contributeStopConditions!(scope('topic-1'))

    hasPendingSteer.mockReturnValue(false)
    expect(await condition({ steps: [] } as any)).toBe(false)

    hasPendingSteer.mockReturnValue(true)
    expect(await condition({ steps: [] } as any)).toBe(true)
  })
})
