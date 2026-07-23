import type { AgentSessionContextUsageSummary } from '@shared/data/cache/cacheValueTypes'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAgentSessionContextUsage } from '../useAgentSessionContextUsage'

const snapshot = {
  categories: [
    { name: 'System prompt', tokens: 12 },
    { name: 'Messages', tokens: 30 }
  ],
  totalTokens: 42,
  maxTokens: 100,
  percentage: 42,
  model: 'claude-sonnet-4-5'
} satisfies AgentSessionContextUsageSummary

describe('useAgentSessionContextUsage', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it('returns no usage when the shared snapshot is absent', () => {
    const { result } = renderHook(() => useAgentSessionContextUsage('session-1'))

    expect(result.current).toEqual({ usage: null, percentage: null })
  })

  it('reads the main-restored shared snapshot', () => {
    MockUseCacheUtils.setSharedCacheValue('agent.session.context_usage.session-1', snapshot)

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1'))

    expect(result.current.usage).toBe(snapshot)
    expect(result.current.percentage).toBe(42)
  })

  it('hides a shared snapshot captured for a different model', () => {
    MockUseCacheUtils.setSharedCacheValue('agent.session.context_usage.session-1', snapshot)

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1', ['claude-opus-4-8']))

    expect(result.current).toEqual({ usage: null, percentage: null })
  })
})
