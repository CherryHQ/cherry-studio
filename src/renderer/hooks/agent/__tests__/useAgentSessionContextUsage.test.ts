import {
  AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY,
  type AgentSessionContextUsage
} from '@shared/ai/agentSessionContextUsage'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/data/hooks/useCache', async () => {
  const { MockUseCache } = await import('@test-mocks/renderer/useCache')
  return MockUseCache
})

const { useAgentSessionContextUsage } = await import('../useAgentSessionContextUsage')

function makeUsage(overrides: Partial<AgentSessionContextUsage> = {}): AgentSessionContextUsage {
  return {
    categories: [{ name: 'Messages', tokens: 42, color: '#fff' }],
    totalTokens: 42,
    maxTokens: 100,
    rawMaxTokens: 100,
    percentage: 42,
    gridRows: [],
    model: 'claude-sonnet-4-5',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: false,
    apiUsage: null,
    ...overrides
  }
}

describe('useAgentSessionContextUsage', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it('reads live usage from the session shared-cache key', () => {
    const live = makeUsage({ percentage: 64 })
    MockUseCacheUtils.setSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'), live)

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1'))

    expect(result.current).toMatchObject({
      usage: live,
      percentage: 64,
      source: 'live',
      capturedAt: undefined
    })
  })

  it('falls back to the persisted snapshot when live shared cache is empty', () => {
    const snapshot = {
      usage: makeUsage({ percentage: 41 }),
      capturedAt: '2026-06-09T12:00:00.000Z'
    }

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1', undefined, snapshot))

    expect(result.current).toMatchObject({
      usage: snapshot.usage,
      percentage: 41,
      source: 'snapshot',
      capturedAt: snapshot.capturedAt
    })
  })

  it('treats a snapshot-shaped shared-cache entry as last measured usage', () => {
    const snapshot = {
      usage: makeUsage({ percentage: 55 }),
      capturedAt: '2026-06-09T12:01:00.000Z'
    }
    MockUseCacheUtils.setSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'), snapshot)

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1'))

    expect(result.current).toMatchObject({
      usage: snapshot.usage,
      percentage: 55,
      source: 'snapshot',
      capturedAt: snapshot.capturedAt
    })
  })

  it('prefers live shared cache over the persisted snapshot', () => {
    const live = makeUsage({ percentage: 64 })
    const snapshot = {
      usage: makeUsage({ percentage: 41 }),
      capturedAt: '2026-06-09T12:00:00.000Z'
    }
    MockUseCacheUtils.setSharedCacheValue(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'), live)

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1', undefined, snapshot))

    expect(result.current).toMatchObject({
      usage: live,
      percentage: 64,
      source: 'live',
      capturedAt: undefined
    })
  })

  it('matches dated provider model aliases against the expected base model', () => {
    const snapshot = {
      usage: makeUsage({ model: 'anthropic::claude-sonnet-4-5-20250929' }),
      capturedAt: '2026-06-09T12:00:00.000Z'
    }

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1', ['claude-sonnet-4-5'], snapshot))

    expect(result.current.source).toBe('snapshot')
    expect(result.current.usage).toBe(snapshot.usage)
  })

  it('does not match shorter model ids against longer model families', () => {
    const snapshot = {
      usage: makeUsage({ model: 'claude-sonnet-4' }),
      capturedAt: '2026-06-09T12:00:00.000Z'
    }

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1', ['claude-sonnet-4-5'], snapshot))

    expect(result.current).toEqual({
      usage: null,
      percentage: null,
      source: 'none',
      capturedAt: undefined
    })
  })

  it('returns none when neither live nor snapshot usage matches the expected model', () => {
    const snapshot = {
      usage: makeUsage({ model: 'claude-opus-4-1' }),
      capturedAt: '2026-06-09T12:00:00.000Z'
    }

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1', ['claude-sonnet-4-5'], snapshot))

    expect(result.current).toEqual({
      usage: null,
      percentage: null,
      source: 'none',
      capturedAt: undefined
    })
  })
})
