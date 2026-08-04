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
    mocks.get.mockReset()
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

  it('loads the exact reusable topic independently of list streams', async () => {
    mocks.get.mockResolvedValueOnce({ topic: null })
    const { result } = renderHook(() => useAssistantTopicsSource())

    await result.current.loadReusableTopic('assistant-a')

    expect(mocks.get).toHaveBeenCalledWith('/topics/reusable-placeholder', {
      query: { assistantId: 'assistant-a' }
    })
  })

  it('loads exact reusable sessions with an optional workspace scope', async () => {
    mocks.get.mockResolvedValueOnce({ sessions: [] })
    const { result } = renderHook(() => useAgentSessionsSource())

    await result.current.loadReusableSessions('agent-a', 'system')

    expect(mocks.get).toHaveBeenCalledWith('/agent-sessions/reusable-placeholders', {
      query: { agentId: 'agent-a', workspaceId: 'system' }
    })
  })
})
