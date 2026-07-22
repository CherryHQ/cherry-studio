import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import type { AgentSessionContextUsageSummary } from '@shared/data/cache/cacheValueTypes'
import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY,
  useAgentSessionContextUsage
} from '../useAgentSessionContextUsage'

const usage = {
  categories: [
    { name: 'System prompt', tokens: 12, color: '#000' },
    { name: 'Messages', tokens: 30, color: '#fff' }
  ],
  totalTokens: 42,
  maxTokens: 100,
  rawMaxTokens: 100,
  percentage: 42,
  gridRows: [],
  model: 'claude-sonnet-4-5',
  memoryFiles: [{ path: '/private/project/CLAUDE.md', type: 'project', tokens: 4 }],
  mcpTools: [],
  agents: [],
  isAutoCompactEnabled: false,
  apiUsage: null
} satisfies AgentSessionContextUsage

const snapshot: AgentSessionContextUsageSummary = {
  categories: [
    { name: 'System prompt', tokens: 12 },
    { name: 'Messages', tokens: 30 }
  ],
  totalTokens: 42,
  maxTokens: 100,
  percentage: 42,
  model: 'claude-sonnet-4-5'
}

describe('useAgentSessionContextUsage', () => {
  beforeEach(() => {
    MockUseCacheUtils.resetMocks()
  })

  it('restores the persisted snapshot when live usage is absent', () => {
    MockUseCacheUtils.setPersistCacheValue(AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY, {
      'session-1': snapshot
    })

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1'))

    expect(result.current).toEqual({ usage: snapshot, percentage: 42 })
  })

  it('prefers live usage and persists only fields used by the UI', async () => {
    MockUseCacheUtils.setSharedCacheValue('agent.session.context_usage.session-1', usage)

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1'))

    expect(result.current.usage).toBe(usage)
    await waitFor(() => {
      expect(MockUseCacheUtils.getPersistCacheValue(AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY)).toEqual({
        'session-1': snapshot
      })
    })
  })

  it('hides a persisted snapshot captured for a different model', () => {
    MockUseCacheUtils.setPersistCacheValue(AGENT_SESSION_CONTEXT_USAGE_SNAPSHOT_CACHE_KEY, {
      'session-1': snapshot
    })

    const { result } = renderHook(() => useAgentSessionContextUsage('session-1', ['claude-opus-4-8']))

    expect(result.current).toEqual({ usage: null, percentage: null })
  })
})
