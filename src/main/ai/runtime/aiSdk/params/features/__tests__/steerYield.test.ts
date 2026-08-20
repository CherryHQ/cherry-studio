import { AiRuntimeKind } from '@main/ai/types'
import { describe, expect, it, vi } from 'vitest'

const hasPendingChatInput = vi.fn()
vi.mock('@application', () => ({
  application: { get: vi.fn(() => ({ hasPendingChatInput })) }
}))

import { steerYieldFeature } from '../steerYield'

const scope = (chatId?: string, runtime?: AiRuntimeKind) =>
  ({
    request: {
      chatId,
      ...(runtime ? { runtime: { kind: runtime, sessionId: 'session-1', turnId: 'turn-1' } } : {})
    }
  }) as any

describe('steerYieldFeature', () => {
  it('applies to chat topics, not agent sessions or topicless requests', () => {
    expect(steerYieldFeature.applies?.(scope('topic-1'))).toBe(true)
    expect(steerYieldFeature.applies?.(scope('session-1', AiRuntimeKind.AgentSession))).toBe(false)
    expect(steerYieldFeature.applies?.(scope(undefined))).toBe(false)
  })

  it('contributes a stop condition that fires only when the topic has a pending steer', async () => {
    const [condition] = steerYieldFeature.contributeStopConditions!(scope('topic-1'))

    hasPendingChatInput.mockReturnValue(false)
    expect(await condition({ steps: [] } as any)).toBe(false)

    hasPendingChatInput.mockReturnValue(true)
    expect(await condition({ steps: [] } as any)).toBe(true)
    expect(hasPendingChatInput).toHaveBeenCalledWith('topic-1')
  })

  it('contributes nothing for an Agent or topicless request', () => {
    expect(steerYieldFeature.contributeStopConditions!(scope('session-1', AiRuntimeKind.AgentSession))).toEqual([])
    expect(steerYieldFeature.contributeStopConditions!(scope(undefined))).toEqual([])
  })
})
