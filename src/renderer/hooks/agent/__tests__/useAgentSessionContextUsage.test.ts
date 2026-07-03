import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useSharedCache: vi.fn()
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  useSharedCache: mocks.useSharedCache
}))

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
    mocks.useSharedCache.mockReturnValue([null])
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

  it('prefers live shared cache over the persisted snapshot', () => {
    const live = makeUsage({ percentage: 64 })
    const snapshot = {
      usage: makeUsage({ percentage: 41 }),
      capturedAt: '2026-06-09T12:00:00.000Z'
    }
    mocks.useSharedCache.mockReturnValue([live])

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
