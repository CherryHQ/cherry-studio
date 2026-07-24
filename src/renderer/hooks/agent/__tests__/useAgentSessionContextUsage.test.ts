import type { AgentSessionContextUsageSummary } from '@shared/data/cache/cacheValueTypes'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY,
  useAgentSessionContextUsage,
  usePersistAgentSessionContextUsageSnapshots
} from '../useAgentSessionContextUsage'

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

const secondSnapshot = {
  ...snapshot,
  totalTokens: 64,
  percentage: 64
} satisfies AgentSessionContextUsageSummary

describe('useAgentSessionContextUsage', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it('returns no usage when the shared snapshot is absent', () => {
    const { result } = renderHook(() => useAgentSessionContextUsage('session-1'))

    expect(result.current).toEqual({ usage: null, percentage: null })
  })

  it('reads a live shared snapshot', () => {
    MockUseCacheUtils.setSharedCacheValue('agent.session.context_usage.session-1', snapshot)

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1'))

    expect(result.current.usage).toBe(snapshot)
    expect(result.current.percentage).toBe(42)
  })

  it('falls back to the renderer-persisted snapshot when live usage is absent', () => {
    MockUseCacheUtils.setPersistCacheValue(AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY, {
      'session-1': snapshot
    })

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

describe('usePersistAgentSessionContextUsageSnapshots', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it('persists live snapshots for multiple known sessions', async () => {
    MockUseCacheUtils.setSharedCacheValue('agent.session.context_usage.session-1', snapshot)
    MockUseCacheUtils.setSharedCacheValue('agent.session.context_usage.session-2', secondSnapshot)

    renderHook(() => usePersistAgentSessionContextUsageSnapshots(['session-1', 'session-2']))

    await waitFor(() =>
      expect(MockUseCacheUtils.getPersistCacheValue(AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY)).toEqual({
        'session-1': snapshot,
        'session-2': secondSnapshot
      })
    )
  })

  it('keeps only the 100 most recently updated snapshots', async () => {
    MockUseCacheUtils.setPersistCacheValue(
      AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY,
      Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `session-${index}`,
          { ...snapshot, totalTokens: index, percentage: index }
        ])
      )
    )
    MockUseCacheUtils.setSharedCacheValue('agent.session.context_usage.session-100', {
      ...snapshot,
      totalTokens: 100,
      percentage: 100
    })

    renderHook(() => usePersistAgentSessionContextUsageSnapshots(['session-100']))

    await waitFor(() => {
      const persisted = MockUseCacheUtils.getPersistCacheValue(AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY)
      expect(Object.keys(persisted)).toHaveLength(100)
      expect(persisted['session-0']).toBeUndefined()
      expect(persisted['session-1']).toBeDefined()
      expect(persisted['session-100']).toMatchObject({ totalTokens: 100, percentage: 100 })
    })
  })
})
