import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAgentSessionsSource, useAssistantTopicsSource } from '../resourceViewSources'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  useAgentSessionStats: vi.fn(),
  useTopicStats: vi.fn()
}))

vi.mock('@renderer/data/DataApiService', () => ({
  dataApiService: { get: mocks.get }
}))

vi.mock('@renderer/hooks/agent/useSession', () => ({
  useAgentSessionStats: mocks.useAgentSessionStats
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  useTopicStats: mocks.useTopicStats
}))

describe('resourceViewSources', () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue({ items: [] })
    mocks.useAgentSessionStats.mockReturnValue({
      stats: undefined,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
    mocks.useTopicStats.mockReturnValue({
      stats: undefined,
      isLoading: false,
      error: undefined,
      refetch: vi.fn()
    })
  })

  it('loads topic seed candidates across pinned and unpinned rows', async () => {
    const { result } = renderHook(() => useAssistantTopicsSource())

    await result.current.loadTopicReuseCandidates('assistant-a')

    expect(mocks.get).toHaveBeenCalledWith('/topics', {
      query: {
        assistantId: 'assistant-a',
        limit: 50,
        sortBy: 'orderKey'
      }
    })
  })

  it('loads session seed candidates across pinned and unpinned rows', async () => {
    const { result } = renderHook(() => useAgentSessionsSource())

    await result.current.loadSessionReuseCandidates('agent-a')

    expect(mocks.get).toHaveBeenCalledWith('/agent-sessions', {
      query: {
        agentId: 'agent-a',
        limit: 50,
        sortBy: 'orderKey'
      }
    })
  })
})
